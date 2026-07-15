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
  'noReactNativeRawText',
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
  '!!**/.venv*',
  '!!**/venv',
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
const PARSE_DIALECTS: readonly string[] = ['file.tsx', 'file.ts', 'file.d.ts']
const DEFAULT_SHARED_IGNORE_PATTERNS: readonly string[] = [
  '_generated/**',
  '.next/**',
  '.source/**',
  '.venv*/**',
  'venv/**',
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
const ESLINT_TEST_FILE_PATTERNS: readonly string[] = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**/*.ts',
  '**/__tests__/**/*.tsx'
]
const BIOME_PATTERN_RULE_OVERRIDES: readonly BiomePatternRuleOverride[] = [
  {
    includes: ['**/expo/**'],
    rules: ['noProcessEnv']
  },
  {
    includes: ['**/maestro/**'],
    rules: ['noAwaitInLoops']
  },
  {
    includes: ['**/auth.config.js'],
    rules: ['noUndeclaredEnvVars', 'noUndeclaredVariables', 'noProcessEnv']
  },
  {
    includes: ['**/*Script.ts', '**/*.generated.ts'],
    rules: ['noTemplateCurlyInString']
  },
  {
    includes: ESLINT_TEST_FILE_PATTERNS,
    rules: [
      'noAwaitInLoops',
      'noDelete',
      'noEmptyBlockStatements',
      'noProcessEnv',
      'noUndeclaredVariables',
      'useAwait',
      'useLiteralKeys',
      'useTopLevelRegex'
    ]
  }
]
const OXLINT_PATTERN_RULE_OVERRIDES: readonly OxlintOverrideConfig[] = [
  {
    files: ['**/expo/**/*.tsx', '**/expo/**/*.ts'],
    rules: {
      'react-perf/jsx-no-new-object-as-prop': 'off'
    }
  },
  {
    files: ['**/convex/**/*.ts'],
    rules: {
      'eslint-plugin-unicorn/filename-case': 'off'
    }
  },
  {
    files: ['**/*Script.ts', '**/*.generated.ts'],
    rules: {
      'eslint/no-template-curly-in-string': 'off'
    }
  },
  {
    files: [...ESLINT_TEST_FILE_PATTERNS],
    rules: {
      'eslint-plugin-jest/valid-expect': 'off',
      'eslint-plugin-promise/param-names': 'off',
      'eslint-plugin-unicorn/consistent-function-scoping': 'off',
      'eslint-plugin-unicorn/no-array-for-each': 'off',
      'eslint-plugin-unicorn/no-immediate-mutation': 'off',
      'eslint-plugin-unicorn/no-useless-promise-resolve-reject': 'off',
      'eslint-plugin-unicorn/number-literal-case': 'off',
      'eslint-plugin-vitest/prefer-called-times': 'off',
      'no-await-in-loop': 'off',
      'no-control-regex': 'off'
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
const SHARED_OVERRIDE_SYMBOL_KEY = 'lintmax.sharedOverride'
const OXLINT_CLI_ALLOW: readonly string[] = [
  'eslint/no-underscore-dangle',
  'react/jsx-no-literals',
  'unicorn/prefer-export-from',
  'react/react-compiler'
]
export {
  BIOME_IGNORE_PATTERNS,
  BIOME_PATTERN_RULE_OVERRIDES,
  BIOME_RULES_OFF,
  DEFAULT_SHARED_IGNORE_PATTERNS,
  ESLINT_TEST_FILE_PATTERNS,
  OXLINT_CLI_ALLOW,
  OXLINT_PATTERN_RULE_OVERRIDES,
  PARSE_DIALECTS,
  SHARED_OVERRIDE_SYMBOL_KEY,
  TAILWIND_ENTRY_CANDIDATES
}
