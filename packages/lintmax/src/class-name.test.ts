/* eslint-disable no-template-curly-in-string */
/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: test fixtures contain JSX template literal strings */
import { describe, expect, test } from 'bun:test'
import { findClassNameViolations } from './class-name.js'
const check = (code: string) => findClassNameViolations({ sourceText: code })
describe('unparseable source', () => {
  test('throws on unreadable source so a check cannot silently report zero violations', () => {
    expect(() => check('<div className={`a-${x}`} />\n<span className={`b-${y}`} />')).toThrow(/cannot parse/v)
  })
})
describe('cn/no-template-literal', () => {
  test.each([
    ['catches template literal className', '<div className={`text-red-500 ${active && "font-bold"}`} />'],
    [
      'catches multiline template literal',
      `<div className={\`
      text-red-500
      \${active ? 'font-bold' : ''}
    \`} />`
    ]
  ] as const)('%s', (_title, source) => {
    const violations = check(source)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-template-literal')
  })
  test.each([
    ['allows static string className', '<div className="text-red-500" />'],
    ['allows cn() with template-like args', '<div className={cn("base", active && "bold")} />']
  ] as const)('%s', (_title, source) => {
    expect(check(source)).toHaveLength(0)
  })
})
describe('cn/no-ternary', () => {
  test('catches bare ternary className', () => {
    const violations = check('<div className={active ? "text-red" : "text-blue"} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-ternary')
  })
  test.each([
    ['allows ternary inside cn()', '<div className={cn(active ? "text-red" : "text-blue")} />'],
    ['allows ternary inside cn() with base classes', '<div className={cn("base", active ? "a" : "b")} />']
  ] as const)('%s', (_title, source) => {
    expect(check(source)).toHaveLength(0)
  })
})
describe('cn/no-concatenation', () => {
  test.each([
    ['catches string concatenation className', '<div className={"base " + extraClass} />'],
    ['catches variable + string concat', '<div className={a + " " + b} />']
  ] as const)('%s', (_title, source) => {
    const violations = check(source)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-concatenation')
  })
  test('allows cn() with multiple args', () => {
    expect(check('<div className={cn("base", extraClass)} />')).toHaveLength(0)
  })
})
describe('cn/no-banned-callee', () => {
  test.each([
    ['catches clsx() in className', '<div className={clsx("base", active && "bold")} />'],
    ['catches classnames() in className', '<div className={classnames("base", { active })} />'],
    ['catches twMerge() in className', '<div className={twMerge("px-2", "px-4")} />'],
    ['catches cx() in className', '<div className={cx("a", "b")} />'],
    ['catches clsx() outside className too', 'const cls = clsx("a", condition && "b")']
  ] as const)('%s', (_title, source) => {
    const violations = check(source)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-banned-callee')
  })
  test('catches classnames() as standalone call', () => {
    const violations = check('const x = classnames("a", { b: true })')
    expect(violations).toHaveLength(1)
  })
  test('allows cn() in className', () => {
    expect(check('<div className={cn("base", active && "bold")} />')).toHaveLength(0)
  })
})
describe('valid patterns (no violations)', () => {
  test.each([
    ['static string className', '<div className="px-4 py-2" />'],
    ['single-quoted static className', "<div className='px-4 py-2' />"],
    ['cn() with boolean AND', '<div className={cn("base", isActive && "active")} />'],
    ['cn() with ternary inside', '<div className={cn("base", x ? "a" : "b")} />'],
    ['cn() with multiple conditions', '<div className={cn("base", a && "x", b && "y", c ? "p" : "q")} />'],
    ['cn() with spread', '<div className={cn("base", ...classes)} />'],
    ['variable className (just a reference)', '<div className={myClassName} />'],
    ['props.className passthrough', '<div className={props.className} />'],
    ['cn() wrapping props.className', '<div className={cn("base", props.className)} />'],
    ['no className attribute at all', '<div id="test" />'],
    ['className in non-JSX context', 'const className = "test"'],
    ['empty file', ''],
    ['no JSX at all', 'const x = 1 + 2']
  ] as const)('%s', (_title, source) => {
    expect(check(source)).toHaveLength(0)
  })
})
describe('edge cases', () => {
  test('nested components with mixed patterns', () => {
    const violations = check(`
      <div className={cn("outer")}>
        <span className={\`inner-\${x}\`} />
      </div>
    `)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-template-literal')
  })
  test('multiple violations in one file', () => {
    const violations = check(`<>
      <div className={\`a-\${x}\`} />
      <span className={active ? "x" : "y"} />
      <p className={"a " + b} />
      <section className={clsx("a", "b")} />
    </>`)
    expect(violations).toHaveLength(4)
    expect(violations.map(v => v.rule).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'cn/no-banned-callee',
      'cn/no-concatenation',
      'cn/no-template-literal',
      'cn/no-ternary'
    ])
  })
  test.each([
    ['className with no-substitution template literal is fine', '<div className={`static-class`} />'],
    ['cn() as direct value not in className is fine', 'const x = cn("a", "b")'],
    ['deeply nested ternary in cn() is allowed', '<div className={cn(a ? b ? "x" : "y" : "z")} />'],
    ['object access className is fine', '<div className={styles.container} />'],
    ['function call that is not banned is fine', '<div className={getClassName()} />']
  ] as const)('%s', (_title, source) => {
    expect(check(source)).toHaveLength(0)
  })
  test('className on custom component', () => {
    const violations = check('<MyComponent className={`text-${color}`} />')
    expect(violations).toHaveLength(1)
  })
  test.each([
    ['component className prop', '<Button className={active ? "primary" : "secondary"} />', 'cn/no-ternary'],
    ['catches array join pattern', '<div className={["a", "b"].join(" ")} />', 'cn/no-join'],
    ['catches variable.join() in className', '<div className={classes.join(" ")} />', 'cn/no-join']
  ] as const)('%s', (_title, source, rule) => {
    const violations = check(source)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe(rule)
  })
})
describe('line numbers', () => {
  test('reports correct line number', () => {
    const violations = check(`const x = 1
const y = 2
const z = <div className={\`test-\${x}\`} />`)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.line).toBe(3)
  })
  test('reports correct lines for multiple violations', () => {
    const violations = check(`<><div className={clsx("a")} />
<span className="ok" />
<p className={\`b-\${x}\`} /></>`)
    expect(violations).toHaveLength(2)
    expect(violations[0]?.line).toBe(1)
    expect(violations[1]?.line).toBe(3)
  })
})
