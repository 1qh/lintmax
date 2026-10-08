import { file, Glob } from 'bun'
import { parseSync } from 'oxc-parser'
import type { Diagnostic } from './aggregate.js'
import { DEFAULT_SHARED_IGNORE_PATTERNS } from './constants.js'
import { listProjectFiles } from './project-files.js'
const containsJsxNode = (program: unknown): boolean => {
  let found = false
  const visit = (node: unknown) => {
    if (found || !node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if ('type' in node && (node.type === 'JSXElement' || node.type === 'JSXFragment')) {
      found = true
      return
    }
    for (const [key, child] of Object.entries(node)) if (key !== 'type') visit(child)
  }
  visit(program)
  return found
}
const hasJsx = (sourceText: string): boolean => {
  // oxlint-disable-next-line node/no-sync
  const asTs = parseSync('file.ts', sourceText)
  if (asTs.errors.length === 0) return false
  // oxlint-disable-next-line node/no-sync
  const asTsx = parseSync('file.tsx', sourceText)
  return containsJsxNode(asTsx.program)
}
const checkJsxExtension = async ({ root }: { root: string }): Promise<Diagnostic[]> => {
  const ignoreGlobs = DEFAULT_SHARED_IGNORE_PATTERNS.map(p => new Glob(p))
  const isIgnored = (p: string): boolean =>
    p.includes('node_modules') || p.endsWith('.d.ts') || ignoreGlobs.some(g => g.match(p))
  const paths = (await listProjectFiles({ root })).filter(p => p.endsWith('.ts') && !isIgnored(p))
  const diagnostics = await Promise.all(
    paths.map(async (path): Promise<Diagnostic[]> => {
      const content = await file(`${root}/${path}`).text()
      if (!hasJsx(content)) return []
      return [
        {
          file: `${root}/${path}`,
          line: 1,
          linter: 'lintmax',
          rule: 'jsx-requires-tsx-extension'
        }
      ]
    })
  )
  return diagnostics.flat()
}
export { checkJsxExtension, hasJsx }
