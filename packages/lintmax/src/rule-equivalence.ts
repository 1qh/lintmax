const equivalenceGroups: string[][] = [
  ['lint/suspicious/noExplicitAny', '@typescript-eslint/no-explicit-any', 'typescript-eslint(no-explicit-any)'],
  ['lint/correctness/noUnusedVariables', '@typescript-eslint/no-unused-vars', 'eslint(no-unused-vars)'],
  ['lint/suspicious/noDebugger', 'no-debugger', 'eslint(no-debugger)'],
  ['lint/correctness/noUnreachable', 'no-unreachable', 'eslint(no-unreachable)'],
  ['lint/suspicious/noDoubleEquals', 'eqeqeq', 'eslint(eqeqeq)'],
  ['lint/suspicious/noDuplicateCase', 'no-duplicate-case', 'eslint(no-duplicate-case)'],
  ['lint/suspicious/noFallthroughSwitchClause', 'no-fallthrough', 'eslint(no-fallthrough)'],
  ['lint/suspicious/noRedeclare', '@typescript-eslint/no-redeclare', 'typescript-eslint(no-redeclare)'],
  ['lint/suspicious/noShadowRestrictedNames', 'no-shadow-restricted-names', 'eslint(no-shadow-restricted-names)'],
  ['lint/correctness/useIsNan', 'use-isnan', 'eslint(use-isnan)'],
  ['lint/correctness/noConstAssign', 'no-const-assign', 'eslint(no-const-assign)'],
  ['lint/correctness/noNewSymbol', 'no-new-symbol', 'eslint(no-new-symbol)'],
  ['lint/correctness/noUndeclaredVariables', 'no-undef', 'eslint(no-undef)'],
  ['lint/suspicious/noEmptyBlockStatements', 'no-empty', 'eslint(no-empty)'],
  ['lint/suspicious/noSelfCompare', 'no-self-compare', 'eslint(no-self-compare)'],
  ['lint/complexity/noUselessConstructor', '@typescript-eslint/no-useless-constructor', 'eslint(no-useless-constructor)'],
  ['lint/suspicious/noArrayIndexKey', 'react/no-array-index-key', 'eslint-plugin-react(no-array-index-key)'],
  ['lint/correctness/useExhaustiveDependencies', 'react-hooks/exhaustive-deps', 'react-hooks(exhaustive-deps)'],
  ['lint/correctness/useHookAtTopLevel', 'react-hooks/rules-of-hooks', 'react-hooks(rules-of-hooks)']
]
const ruleToCanonical = new Map<string, string>()
for (const group of equivalenceGroups) {
  const canonical = group[0] ?? ''
  for (const rule of group) ruleToCanonical.set(rule, canonical)
}
const getCanonicalRule = (rule: string): string => ruleToCanonical.get(rule) ?? rule
export { getCanonicalRule }
