import { file, write } from 'bun'
import ts from 'typescript'
import type { Diagnostic } from './aggregate.js'

const KEEP_PATTERN =
  /eslint-disable|biome-ignore|oxlint-disable|@ts-nocheck|@ts-expect-error|@ts-ignore|@refresh|@flow|istanbul ignore|c8 ignore|webpackChunkName|prettier-ignore|noinspection|nolint|@jsx|@jsxImportSource|@jsxFrag|@license|@preserve|type-coverage:ignore/u
const WHITESPACE_ONLY = /^\s*$/u
const COMMENT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const extOf = (path: string): string => {
  const dot = path.lastIndexOf('.')
  return dot > path.lastIndexOf('/') ? path.slice(dot) : ''
}
const isCommentCandidate = (path: string): boolean => COMMENT_EXTENSIONS.has(extOf(path))
const findDeletableComments = ({ sourceText }: { sourceText: string }): { end: number; line: number; start: number }[] => {
  const sourceFile = ts.createSourceFile('file.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const seen = new Set<number>()
  const deletable: { end: number; line: number; start: number }[] = []
  const visit = (node: ts.Node) => {
    const leading = ts.getLeadingCommentRanges(sourceText, node.getFullStart())
    const trailing = ts.getTrailingCommentRanges(sourceText, node.getEnd())
    const ranges = [...(leading ?? []), ...(trailing ?? [])]
    for (const range of ranges)
      if (!seen.has(range.pos)) {
        seen.add(range.pos)
        const text = sourceText.slice(range.pos, range.end)
        if (!(text.startsWith('#!') || text.startsWith('/**') || text.startsWith('/// <') || KEEP_PATTERN.test(text))) {
          const line = sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1
          deletable.push({ end: range.end, line, start: range.pos })
        }
      }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  deletable.sort((a, b) => a.start - b.start)
  return deletable
}
const deleteComments = ({ sourceText }: { sourceText: string }): string => {
  const comments = findDeletableComments({ sourceText })
  if (comments.length === 0) return sourceText
  const parts: string[] = []
  let cursor = 0
  for (const c of comments) {
    const beforeChunk = sourceText.slice(cursor, c.start)
    const lineStart = beforeChunk.lastIndexOf('\n') + 1
    const indent = beforeChunk.slice(lineStart)
    let afterEnd = c.end
    if (sourceText[afterEnd] === '\n') afterEnd += 1
    else if (sourceText[afterEnd] === '\r' && sourceText[afterEnd + 1] === '\n') afterEnd += 2
    if (WHITESPACE_ONLY.test(indent) && afterEnd <= sourceText.length) {
      parts.push(beforeChunk.slice(0, lineStart))
      cursor = afterEnd
    } else {
      parts.push(beforeChunk)
      cursor = c.end
    }
  }
  parts.push(sourceText.slice(cursor))
  return parts.join('')
}
const processFile = async (filePath: string): Promise<{ diagnostics: Diagnostic[]; modified: boolean }> => {
  if (!isCommentCandidate(filePath)) return { diagnostics: [], modified: false }
  const f = file(filePath)
  if (!(await f.exists())) return { diagnostics: [], modified: false }
  const sourceText = await f.text()
  const comments = findDeletableComments({ sourceText })
  const diagnostics: Diagnostic[] = []
  for (const c of comments)
    diagnostics.push({
      file: filePath,
      line: c.line,
      linter: 'comments',
      rule: 'deletable'
    })
  return { diagnostics, modified: false }
}
const processFileForFix = async (filePath: string): Promise<boolean> => {
  if (!isCommentCandidate(filePath)) return false
  const f = file(filePath)
  if (!(await f.exists())) return false
  const sourceText = await f.text()
  const result = deleteComments({ sourceText })
  if (result !== sourceText) {
    await write(filePath, result)
    return true
  }
  return false
}
const checkComments = async ({ files }: { files: string[] }): Promise<Diagnostic[]> => {
  const results = await Promise.all(files.map(async f => processFile(f)))
  return results.flatMap(r => r.diagnostics)
}
const fixComments = async ({ files }: { files: string[] }): Promise<number> => {
  const results = await Promise.all(files.map(async f => processFileForFix(f)))
  return results.filter(Boolean).length
}
export { checkComments, fixComments }
