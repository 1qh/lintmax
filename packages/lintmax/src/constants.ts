interface BiomePatternRuleOverride {
  includes: readonly string[]
  rules: readonly string[]
}
interface OxlintOverrideConfig {
  files: readonly string[]
  rules: Readonly<Record<string, 'off'>>
}
const BIOME_RULES_OFF: readonly string[] = [
  'noBarrelFile',
  'noConditionalExpect',
  'noConsole',
  'noDefaultExport',
  'noExcessiveCognitiveComplexity',
  'noExcessiveLinesPerFile',
  'noExcessiveLinesPerFunction',
  'noExportedImports',
  'noImplicitBoolean',
  'noImportantStyles',
  'noInlineStyles',
  'noLeakedRender',
  'useConsistentCurlyBraces',
  'useConsistentMemberAccessibility',
  'useExpect',
  'noJsxLiterals',
  'noJsxPropsBind',
  'noMagicNumbers',
  'noNestedTernary',
  'noNodejsModules',
  'noProcessGlobal',
  'noReactSpecificProps',
  'noSecrets',
  'noSolidDestructuredProps',
  'noTernary',
  'noUndeclaredDependencies',
  'noUnresolvedImports',
  'useBaseline',
  'useBlockStatements',
  'useComponentExportOnlyModules',
  'useDestructuring',
  'useConsistentTestIt',
  'useExplicitReturnType',
  'useExplicitType',
  'useImportExtensions',
  'useNamingConvention',
  'useQwikValidLexicalScope',
  'useSingleVarDeclarator',
  'useSolidForComponent',
  'useSortedClasses'
]
const BIOME_IGNORE_PATTERNS: readonly string[] = [
  '!!**/node_modules',
  '!!**/.build',
  '!!**/.cache',
  '!!**/.source',
  '!!**/.next',
  '!!**/.output',
  '!!**/.turbo',
  '!!**/.venv',
  '!!**/.wxt',
  '!!**/_generated',
  '!!**/Android',
  '!!**/Darwin',
  '!!**/dist',
  '!!**/maestro',
  '!!**/module_bindings',
  '!!**/playwright-report',
  '!!**/test-results',
  '!!**/*.xcassets'
]
const DEFAULT_SHARED_IGNORE_PATTERNS: readonly string[] = [
  '_generated/**',
  '.next/**',
  '.source/**',
  'dist/**',
  'generated/**',
  'module_bindings/**',
  'next-env.d.ts',
  'readonly/**',
  'expo/**/babel.config.js',
  'expo/**/global.css',
  'expo/**/metro.config.js',
  'expo/**/uniwind-env.d.ts',
  'expo/**/uniwind-types.d.ts'
].map(p => (p.startsWith('**/') ? p : `**/${p}`))
const BIOME_PATTERN_RULE_OVERRIDES: readonly BiomePatternRuleOverride[] = [
  {
    includes: ['**/expo/**'],
    rules: ['style/noProcessEnv']
  },
  {
    includes: ['**/maestro/**'],
    rules: ['performance/noAwaitInLoops']
  }
]
const OXLINT_PATTERN_RULE_OVERRIDES: readonly OxlintOverrideConfig[] = [
  {
    files: ['**/expo/**/*.tsx', '**/expo/**/*.ts'],
    rules: {
      'react-perf/jsx-no-new-object-as-prop': 'off'
    }
  }
]
const TAILWIND_ENTRY_CANDIDATES: readonly string[] = [
  'ui/src/styles/globals.css',
  'src/styles/globals.css',
  'app/globals.css',
  'web/global.css',
  'styles/globals.css',
  'global.css'
]
const ESLINT_TEST_FILE_PATTERNS: readonly string[] = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**/*.ts',
  '**/__tests__/**/*.tsx'
]
const SHARED_OVERRIDE_SYMBOL_KEY = 'lintmax.sharedOverride'
export {
  BIOME_IGNORE_PATTERNS,
  BIOME_PATTERN_RULE_OVERRIDES,
  BIOME_RULES_OFF,
  DEFAULT_SHARED_IGNORE_PATTERNS,
  ESLINT_TEST_FILE_PATTERNS,
  OXLINT_PATTERN_RULE_OVERRIDES,
  SHARED_OVERRIDE_SYMBOL_KEY,
  TAILWIND_ENTRY_CANDIDATES
}
