import { file, Glob } from 'bun'
import type { Diagnostic } from './aggregate.js'
import { parseAnyDialect } from './parse-source.js'

const CN_NAMES = new Set(['cn'])
const BANNED_CALLEE_NAMES = new Set(['classnames', 'clsx', 'cx', 'twMerge'])
interface Node {
  [key: string]: unknown
  callee?: Node
  expression?: Node
  name?: unknown
  operator?: unknown
  start: number
  type: string
  value?: Node
}
const asNode = (v: unknown): Node | null =>
  v && typeof v === 'object' && typeof (v as Node).type === 'string' ? (v as Node) : null
const strName = (n: Node | undefined): string => (typeof n?.name === 'string' ? n.name : '')
const lineAt = (sourceText: string, offset: number): number => {
  let line = 1
  for (let i = 0; i < offset && i < sourceText.length; i += 1) if (sourceText[i] === '\n') line += 1
  return line
}
const isClassNameAttr = (n: Node | null): boolean => {
  const name = asNode(n?.name)
  return n?.type === 'JSXAttribute' && name?.type === 'JSXIdentifier' && strName(name) === 'className'
}
const isCallToCn = (n: Node): boolean =>
  n.type === 'CallExpression' && n.callee?.type === 'Identifier' && CN_NAMES.has(strName(n.callee))
const isJoinCall = (n: Node): boolean => {
  const property = asNode(n.callee?.property)
  return (
    n.type === 'CallExpression' &&
    n.callee?.type === 'MemberExpression' &&
    property?.type === 'Identifier' &&
    strName(property) === 'join'
  )
}
const isBannedCallee = (n: Node): boolean =>
  n.type === 'CallExpression' && n.callee?.type === 'Identifier' && BANNED_CALLEE_NAMES.has(strName(n.callee))
const isStringLiteral = (n: Node): boolean =>
  (n.type === 'Literal' && typeof n.value === 'string') ||
  (n.type === 'TemplateLiteral' && Array.isArray(n.expressions) && n.expressions.length === 0)
interface Violation {
  line: number
  rule: string
}
const classNameExprRule = (expr: Node): null | string => {
  if (isStringLiteral(expr) || isCallToCn(expr)) return null
  if (expr.type === 'TemplateLiteral') return 'cn/no-template-literal'
  if (expr.type === 'ConditionalExpression') return 'cn/no-ternary'
  if (expr.type === 'BinaryExpression' && expr.operator === '+') return 'cn/no-concatenation'
  if (isBannedCallee(expr)) return 'cn/no-banned-callee'
  if (isJoinCall(expr)) return 'cn/no-join'
  return null
}
const collectClassNameAttrViolation = (node: Node, sourceText: string, violations: Violation[]): void => {
  const container = node.value
  if (isClassNameAttr(node) && container?.type === 'JSXExpressionContainer' && container.expression) {
    const rule = classNameExprRule(container.expression)
    if (rule) violations.push({ line: lineAt(sourceText, container.expression.start), rule })
  }
}
const collectBannedCalleeViolation = ({
  grand,
  node,
  parent,
  sourceText,
  violations
}: {
  grand: Node | null
  node: Node
  parent: Node | null
  sourceText: string
  violations: Violation[]
}): void => {
  if (isBannedCallee(node) && (parent?.type !== 'JSXExpressionContainer' || !isClassNameAttr(grand)))
    violations.push({ line: lineAt(sourceText, node.start), rule: 'cn/no-banned-callee' })
}
const findClassNameViolations = ({ sourceText }: { sourceText: string }): Violation[] => {
  const { program } = parseAnyDialect({ label: 'className check', sourceText })
  const violations: Violation[] = []
  const visit = (raw: unknown, parent: Node | null, grand: Node | null) => {
    if (Array.isArray(raw)) {
      for (const child of raw) visit(child, parent, grand)
      return
    }
    const node = asNode(raw)
    if (!node) {
      if (raw && typeof raw === 'object')
        for (const key of Object.keys(raw)) visit((raw as Record<string, unknown>)[key], parent, grand)
      return
    }
    collectClassNameAttrViolation(node, sourceText, violations)
    collectBannedCalleeViolation({ grand, node, parent, sourceText, violations })
    for (const key of Object.keys(node)) if (key !== 'type') visit(node[key], node, parent)
  }
  visit(program, null, null)
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
  for await (const path of glob.scan({ absolute: true, cwd: root, dot: false }))
    if (!(path.includes('node_modules') || path.includes('readonly') || path.includes('.next') || path.includes('dist'))) {
      const diagnostics = await checkClassNameFile(path)
      allDiagnostics.push(...diagnostics)
    }
  return allDiagnostics
}
export { BANNED_CALLEE_NAMES, checkClassName, checkClassNameFile, CN_NAMES, findClassNameViolations }
