/* eslint-disable no-continue */
/** biome-ignore-all lint/nursery/noContinue: scan loop */
import { file, Glob } from 'bun'
import ts from 'typescript'
import type { Diagnostic } from './aggregate.js'
import { DEFAULT_SHARED_IGNORE_PATTERNS } from './constants.js'
const containsJsxNode = (sourceFile: ts.SourceFile): boolean => {
  let found = false
  const visit = (node: ts.Node) => {
    if (found) return
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return found
}
const hasJsx = (sourceText: string): boolean => {
  const tsFile = ts.createSourceFile('file.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const diags = (tsFile as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics
  const hasTsErrors = Array.isArray(diags) && diags.length > 0
  if (!hasTsErrors) return false
  const tsxFile = ts.createSourceFile('file.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return containsJsxNode(tsxFile)
}
const checkJsxExtension = async ({ root }: { root: string }): Promise<Diagnostic[]> => {
  const glob = new Glob('**/*.ts')
  const ignoreGlobs = DEFAULT_SHARED_IGNORE_PATTERNS.map(p => new Glob(p))
  const isIgnored = (p: string): boolean =>
    p.includes('node_modules') || p.endsWith('.d.ts') || ignoreGlobs.some(g => g.match(p))
  const diagnostics: Diagnostic[] = []
  for await (const path of glob.scan({ absolute: false, cwd: root, dot: false })) {
    if (isIgnored(path)) continue
    const content = await file(`${root}/${path}`).text()
    if (hasJsx(content))
      diagnostics.push({
        file: `${root}/${path}`,
        line: 1,
        linter: 'lintmax',
        rule: 'jsx-requires-tsx-extension'
      })
  }
  return diagnostics
}
export { checkJsxExtension, hasJsx }
