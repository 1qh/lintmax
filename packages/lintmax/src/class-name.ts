/* eslint-disable max-depth, no-continue */
/** biome-ignore-all lint/nursery/noContinue: AST traversal requires continue */
import { file, Glob } from 'bun'
import ts from 'typescript'
import type { Diagnostic } from './aggregate.js'
const CN_NAMES = new Set(['cn'])
const BANNED_CALLEE_NAMES = new Set(['classnames', 'clsx', 'cx', 'twMerge'])
const isJsxClassName = (node: ts.Node): boolean =>
  ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'className'
const isCallToCn = (node: ts.Node): boolean =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CN_NAMES.has(node.expression.text)
const isJoinCall = (node: ts.Node): boolean =>
  ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join'
const isBannedCallee = (node: ts.Node): boolean =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && BANNED_CALLEE_NAMES.has(node.expression.text)
const isStringLiteral = (node: ts.Node): boolean => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
interface Violation {
  line: number
  rule: string
}
const findClassNameViolations = ({ sourceText }: { sourceText: string }): Violation[] => {
  const sourceFile = ts.createSourceFile('file.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const violations: Violation[] = []
  const visit = (node: ts.Node) => {
    if (isJsxClassName(node)) {
      const attr = node as ts.JsxAttribute
      const init = attr.initializer
      if (init && ts.isJsxExpression(init) && init.expression) {
        const expr = init.expression
        if (!(isStringLiteral(expr) || isCallToCn(expr))) {
          const line = sourceFile.getLineAndCharacterOfPosition(expr.getStart()).line + 1
          if (ts.isTemplateLiteral(expr)) violations.push({ line, rule: 'cn/no-template-literal' })
          else if (ts.isConditionalExpression(expr)) violations.push({ line, rule: 'cn/no-ternary' })
          else if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken)
            violations.push({ line, rule: 'cn/no-concatenation' })
          else if (isBannedCallee(expr)) violations.push({ line, rule: 'cn/no-banned-callee' })
          else if (isJoinCall(expr)) violations.push({ line, rule: 'cn/no-join' })
          else if (ts.isCallExpression(expr) && !isCallToCn(expr)) {
            const callee = expr.expression
            if (ts.isIdentifier(callee) && BANNED_CALLEE_NAMES.has(callee.text))
              violations.push({ line, rule: 'cn/no-banned-callee' })
          }
        }
      }
    }
    if (isBannedCallee(node)) {
      const call = node as ts.CallExpression
      const { parent } = call
      if (!(ts.isJsxExpression(parent) && isJsxClassName(parent.parent))) {
        const line = sourceFile.getLineAndCharacterOfPosition(call.getStart()).line + 1
        violations.push({ line, rule: 'cn/no-banned-callee' })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}
const TSX_EXTENSIONS = new Set(['.tsx'])
const isTsxFile = (path: string): boolean => {
  const dot = path.lastIndexOf('.')
  return dot > path.lastIndexOf('/') && TSX_EXTENSIONS.has(path.slice(dot))
}
const checkClassNameFile = async (filePath: string): Promise<Diagnostic[]> => {
  if (!isTsxFile(filePath)) return []
  const f = file(filePath)
  if (!(await f.exists())) return []
  const sourceText = await f.text()
  const violations = findClassNameViolations({ sourceText })
  return violations.map(v => ({
    file: filePath,
    line: v.line,
    linter: 'cn',
    rule: v.rule
  }))
}
const checkClassName = async ({ root }: { root: string }): Promise<Diagnostic[]> => {
  const glob = new Glob('**/*.tsx')
  const allDiagnostics: Diagnostic[] = []
  for await (const path of glob.scan({ absolute: true, cwd: root, dot: false })) {
    if (path.includes('node_modules') || path.includes('readonly') || path.includes('.next') || path.includes('dist'))
      continue
    const diagnostics = await checkClassNameFile(path)
    allDiagnostics.push(...diagnostics)
  }
  return allDiagnostics
}
export { BANNED_CALLEE_NAMES, checkClassName, checkClassNameFile, CN_NAMES, findClassNameViolations }
