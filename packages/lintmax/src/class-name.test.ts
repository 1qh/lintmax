/* eslint-disable no-template-curly-in-string */
/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: test fixtures contain JSX template literal strings */
import { describe, expect, test } from 'bun:test'
import { findClassNameViolations } from './class-name.js'

const check = (code: string) => findClassNameViolations({ sourceText: code })
describe('cn/no-template-literal', () => {
  test('catches template literal className', () => {
    const violations = check('<div className={`text-red-500 ${active && "font-bold"}`} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-template-literal')
  })
  test('catches multiline template literal', () => {
    const violations = check(`<div className={\`
      text-red-500
      \${active ? 'font-bold' : ''}
    \`} />`)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-template-literal')
  })
  test('allows static string className', () => {
    expect(check('<div className="text-red-500" />')).toHaveLength(0)
  })
  test('allows cn() with template-like args', () => {
    expect(check('<div className={cn("base", active && "bold")} />')).toHaveLength(0)
  })
})
describe('cn/no-ternary', () => {
  test('catches bare ternary className', () => {
    const violations = check('<div className={active ? "text-red" : "text-blue"} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-ternary')
  })
  test('allows ternary inside cn()', () => {
    expect(check('<div className={cn(active ? "text-red" : "text-blue")} />')).toHaveLength(0)
  })
  test('allows ternary inside cn() with base classes', () => {
    expect(check('<div className={cn("base", active ? "a" : "b")} />')).toHaveLength(0)
  })
})
describe('cn/no-concatenation', () => {
  test('catches string concatenation className', () => {
    const violations = check('<div className={"base " + extraClass} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-concatenation')
  })
  test('catches variable + string concat', () => {
    const violations = check('<div className={a + " " + b} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-concatenation')
  })
  test('allows cn() with multiple args', () => {
    expect(check('<div className={cn("base", extraClass)} />')).toHaveLength(0)
  })
})
describe('cn/no-banned-callee', () => {
  test('catches clsx() in className', () => {
    const violations = check('<div className={clsx("base", active && "bold")} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-banned-callee')
  })
  test('catches classnames() in className', () => {
    const violations = check('<div className={classnames("base", { active })} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-banned-callee')
  })
  test('catches twMerge() in className', () => {
    const violations = check('<div className={twMerge("px-2", "px-4")} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-banned-callee')
  })
  test('catches cx() in className', () => {
    const violations = check('<div className={cx("a", "b")} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-banned-callee')
  })
  test('catches clsx() outside className too', () => {
    const violations = check('const cls = clsx("a", condition && "b")')
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
  test('static string className', () => {
    expect(check('<div className="px-4 py-2" />')).toHaveLength(0)
  })
  test('single-quoted static className', () => {
    expect(check("<div className='px-4 py-2' />")).toHaveLength(0)
  })
  test('cn() with boolean AND', () => {
    expect(check('<div className={cn("base", isActive && "active")} />')).toHaveLength(0)
  })
  test('cn() with ternary inside', () => {
    expect(check('<div className={cn("base", x ? "a" : "b")} />')).toHaveLength(0)
  })
  test('cn() with multiple conditions', () => {
    expect(check('<div className={cn("base", a && "x", b && "y", c ? "p" : "q")} />')).toHaveLength(0)
  })
  test('cn() with spread', () => {
    expect(check('<div className={cn("base", ...classes)} />')).toHaveLength(0)
  })
  test('variable className (just a reference)', () => {
    expect(check('<div className={myClassName} />')).toHaveLength(0)
  })
  test('props.className passthrough', () => {
    expect(check('<div className={props.className} />')).toHaveLength(0)
  })
  test('cn() wrapping props.className', () => {
    expect(check('<div className={cn("base", props.className)} />')).toHaveLength(0)
  })
  test('no className attribute at all', () => {
    expect(check('<div id="test" />')).toHaveLength(0)
  })
  test('className in non-JSX context', () => {
    expect(check('const className = "test"')).toHaveLength(0)
  })
  test('empty file', () => {
    expect(check('')).toHaveLength(0)
  })
  test('no JSX at all', () => {
    expect(check('const x = 1 + 2')).toHaveLength(0)
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
    const violations = check(`
      <div className={\`a-\${x}\`} />
      <span className={active ? "x" : "y"} />
      <p className={"a " + b} />
      <section className={clsx("a", "b")} />
    `)
    expect(violations).toHaveLength(4)
    expect(violations.map(v => v.rule).toSorted()).toEqual([
      'cn/no-banned-callee',
      'cn/no-concatenation',
      'cn/no-template-literal',
      'cn/no-ternary'
    ])
  })
  test('className with no-substitution template literal is fine', () => {
    expect(check('<div className={`static-class`} />')).toHaveLength(0)
  })
  test('component className prop', () => {
    const violations = check('<Button className={active ? "primary" : "secondary"} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-ternary')
  })
  test('cn() as direct value not in className is fine', () => {
    expect(check('const x = cn("a", "b")')).toHaveLength(0)
  })
  test('deeply nested ternary in cn() is allowed', () => {
    expect(check('<div className={cn(a ? b ? "x" : "y" : "z")} />')).toHaveLength(0)
  })
  test('className on custom component', () => {
    const violations = check('<MyComponent className={`text-${color}`} />')
    expect(violations).toHaveLength(1)
  })
  test('catches array join pattern', () => {
    const violations = check('<div className={["a", "b"].join(" ")} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-join')
  })
  test('catches variable.join() in className', () => {
    const violations = check('<div className={classes.join(" ")} />')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('cn/no-join')
  })
  test('object access className is fine', () => {
    expect(check('<div className={styles.container} />')).toHaveLength(0)
  })
  test('function call that is not banned is fine', () => {
    expect(check('<div className={getClassName()} />')).toHaveLength(0)
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
    const violations = check(`<div className={clsx("a")} />
<span className="ok" />
<p className={\`b-\${x}\`} />`)
    expect(violations).toHaveLength(2)
    expect(violations[0]?.line).toBe(1)
    expect(violations[1]?.line).toBe(3)
  })
})
