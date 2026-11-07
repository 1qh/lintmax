import { file, write } from 'bun'
import type { Diagnostic } from './aggregate.js'
import { parseAnyDialect } from './parse-source.js'
const lineAt = (sourceText: string, offset: number): number => {
  let line = 1
  for (let i = 0; i < offset && i < sourceText.length; i += 1) if (sourceText[i] === '\n') line += 1
  return line
}
const KEEP_PATTERN =
  /biome-ignore|eslint-disable|oxlint-disable|@ts-nocheck|@ts-expect-error|@ts-ignore|@refresh|@flow|c8 ignore|istanbul ignore|noinspection|nolint|prettier-ignore|webpackChunkName|@jsx|@license|@preserve|type-coverage:ignore/v
const WHITESPACE_ONLY = /^\s*$/v
const WS_CHAR = /\s/v
const COMMENT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const extOf = (path: string): string => {
  const dot = path.lastIndexOf('.')
  return dot > path.lastIndexOf('/') ? path.slice(dot) : ''
}
const isCommentCandidate = (path: string): boolean => COMMENT_EXTENSIONS.has(extOf(path))
const isBlockOnlyComment = (
  sourceText: string,
  comments: { end: number; start: number }[],
  c: { end: number; start: number }
): boolean => {
  const inComment = (idx: number): boolean => comments.some(o => idx >= o.start && idx < o.end)
  let before = c.start - 1
  while (before >= 0 && (WS_CHAR.test(sourceText[before] ?? '') || inComment(before))) before -= 1
  let after = c.end
  while (after < sourceText.length && (WS_CHAR.test(sourceText[after] ?? '') || inComment(after))) after += 1
  return sourceText[before] === '{' && sourceText[after] === '}'
}
interface DeletableComment {
  end: number
  line: number
  start: number
}
const findDeletableComments = async ({ sourceText }: { sourceText: string }): Promise<DeletableComment[]> => {
  const parsed = await parseAnyDialect({ label: 'comment strip', sourceText })
  const { comments } = parsed
  const deletable: { end: number; line: number; start: number }[] = []
  for (const c of comments) {
    const text = sourceText.slice(c.start, c.end)
    const keep =
      text.startsWith('#!') ||
      text.startsWith('/**') ||
      text.startsWith('/// <') ||
      KEEP_PATTERN.test(text) ||
      isBlockOnlyComment(sourceText, comments, c)
    if (!keep) deletable.push({ end: c.end, line: lineAt(sourceText, c.start), start: c.start })
  }
  deletable.sort((a, b) => a.start - b.start)
  return deletable
}
const skipLineEnding = (sourceText: string, end: number): number => {
  if (sourceText[end] === '\n') return end + 1
  if (sourceText[end] === '\r' && sourceText[end + 1] === '\n') return end + 2
  return end
}
const appendWithoutComment = ({
  comment,
  cursor,
  parts,
  sourceText
}: {
  comment: DeletableComment
  cursor: number
  parts: string[]
  sourceText: string
}): number => {
  const beforeChunk = sourceText.slice(cursor, comment.start)
  const lineStart = beforeChunk.lastIndexOf('\n') + 1
  const indent = beforeChunk.slice(lineStart)
  const afterEnd = skipLineEnding(sourceText, comment.end)
  if (WHITESPACE_ONLY.test(indent) && afterEnd <= sourceText.length) {
    parts.push(beforeChunk.slice(0, lineStart))
    return afterEnd
  }
  parts.push(beforeChunk)
  return comment.end
}
const deleteComments = async ({ sourceText }: { sourceText: string }): Promise<string> => {
  const comments = await findDeletableComments({ sourceText })
  if (comments.length === 0) return sourceText
  const parts: string[] = []
  let cursor = 0
  for (const c of comments) cursor = appendWithoutComment({ comment: c, cursor, parts, sourceText })
  parts.push(sourceText.slice(cursor))
  return parts.join('')
}
const processFile = async (filePath: string): Promise<{ diagnostics: Diagnostic[]; modified: boolean }> => {
  if (!isCommentCandidate(filePath)) return { diagnostics: [], modified: false }
  const f = file(filePath)
  if (!(await f.exists())) return { diagnostics: [], modified: false }
  const sourceText = await f.text()
  const comments = await findDeletableComments({ sourceText })
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
  const result = await deleteComments({ sourceText })
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
