/* eslint-disable @typescript-eslint/no-deprecated */
import type { Linter } from 'eslint'
import eslintReact from '@eslint-react/eslint-plugin'
// eslint-disable-next-line sonarjs/deprecation -- reason: the replacement includeIgnoreFile from @eslint/config-helpers (and eslint/config) is documented but NOT exported in the installed eslint/config-helpers version; revisit when it ships the export
import { includeIgnoreFile } from '@eslint/compat'
import eslint from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import { file } from 'bun'
import eslintPluginBetterTailwindcss from 'eslint-plugin-better-tailwindcss'
import erasableSyntaxOnly from 'eslint-plugin-erasable-syntax-only'
import { configs as packageJsonConfigs } from 'eslint-plugin-package-json'
import { configs as perfectionist } from 'eslint-plugin-perfectionist'
import preferArrow from 'eslint-plugin-prefer-arrow-functions'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import { configs as regexpConfigs } from 'eslint-plugin-regexp'
import sonarjs from 'eslint-plugin-sonarjs'
import turbo from 'eslint-plugin-turbo'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'
import type { EslintOptions } from './lintmax-types.js'
import {
  DEFAULT_SHARED_IGNORE_PATTERNS,
  ESLINT_TEST_FILE_PATTERNS,
  SHARED_OVERRIDE_SYMBOL_KEY,
  TAILWIND_ENTRY_CANDIDATES
} from './constants.js'
import {
  findUnknownRules,
  isRecord,
  normalizeObjectListInput,
  normalizePathListInput,
  normalizeRulesOffInput,
  normalizeTailwindOption,
  warnToError
} from './normalize.js'
import { isAbsolutePath, joinPath } from './path.js'

interface SharedOverrideAppendConfig {
  files?: string[]
  rules?: Linter.RulesRecord
}
const sharedOverrideMarker = Symbol.for(SHARED_OVERRIDE_SYMBOL_KEY)
const normalizeAppendInput = ({ append }: { append: EslintOptions['append'] }): Linter.Config[] => {
  const out: Linter.Config[] = []
  for (const value of normalizeObjectListInput({ allowNonPlain: true, label: 'eslint.append', value: append }))
    out.push(value)
  return out
}
const validateEslintOptions = async ({ options }: { options?: EslintOptions }): Promise<void> => {
  if (!options) return
  if (options.ignores !== undefined)
    normalizePathListInput({
      allowUndefined: true,
      label: 'eslint.ignores',
      value: options.ignores
    })
  if (options.off !== undefined)
    normalizeRulesOffInput({
      label: 'eslint.off',
      value: options.off
    })
  if (options.append !== undefined) normalizeAppendInput({ append: options.append })
  const tailwind = normalizeTailwindOption({
    label: 'eslint.tailwind',
    value: options.tailwind
  })
  const tailwindEntrySetting = tailwind
  if (typeof tailwindEntrySetting === 'string') {
    const root = options.tsconfigRootDir ?? process.cwd()
    const resolved = isAbsolutePath(tailwindEntrySetting) ? tailwindEntrySetting : joinPath(root, tailwindEntrySetting)
    const resolvedExists = await file(resolved).exists()
    if (!resolvedExists)
      throw new Error(
        `eslint.tailwind file not found: ${resolved}. Use an existing path, set eslint.tailwind to false, or remove eslint.tailwind to use auto-detection.`
      )
  }
  if (options.tsconfigRootDir !== undefined && typeof options.tsconfigRootDir !== 'string')
    throw new Error('eslint.tsconfigRootDir must be a string')
}
const collectKnownEslintRuleNames = ({
  appendConfigs,
  baseConfigs
}: {
  appendConfigs: Linter.Config[]
  baseConfigs: Parameters<typeof defineConfig>
}): Set<string> => {
  const knownRuleNames = new Set<string>()
  const seenConfigs = new WeakSet<object>()
  const collectPluginRuleNames = ({ plugins }: { plugins: unknown }) => {
    if (!isRecord(plugins)) return
    for (const [pluginName, plugin] of Object.entries(plugins))
      if (isRecord(plugin) && isRecord(plugin.rules))
        for (const ruleName of Object.keys(plugin.rules)) knownRuleNames.add(`${pluginName}/${ruleName}`)
  }
  const collectFromConfig = ({ config, includeRules }: { config: unknown; includeRules: boolean }) => {
    if (typeof config !== 'object' || config === null) return
    if (seenConfigs.has(config)) return
    seenConfigs.add(config)
    if (Array.isArray(config)) {
      for (const entry of config) collectFromConfig({ config: entry, includeRules })
      return
    }
    if (!isRecord(config)) return
    if (includeRules && isRecord(config.rules))
      for (const ruleName of Object.keys(config.rules)) knownRuleNames.add(ruleName)
    if ('plugins' in config) collectPluginRuleNames({ plugins: config.plugins })
    if ('extends' in config) collectFromConfig({ config: config.extends, includeRules: true })
  }
  for (const config of baseConfigs) collectFromConfig({ config, includeRules: true })
  for (const config of appendConfigs) collectFromConfig({ config, includeRules: false })
  return knownRuleNames
}
const getSharedAppendConfig = ({ config }: { config: Linter.Config }): null | SharedOverrideAppendConfig => {
  if (Reflect.get(config, sharedOverrideMarker) !== true) return null
  /** biome-ignore lint/nursery/noUnsafeTypeAssertion: internal marker identifies this external config as the shared append shape */
  return config as SharedOverrideAppendConfig
}
const resolveTailwindEntry = async ({
  root,
  tailwind
}: {
  root: string
  tailwind: boolean | string | undefined
}): Promise<string | undefined> => {
  const tailwindSetting = tailwind ?? true
  if (tailwindSetting === false) return
  if (typeof tailwindSetting === 'string')
    return isAbsolutePath(tailwindSetting) ? tailwindSetting : joinPath(root, tailwindSetting)
  const matches = (
    await Promise.all(
      TAILWIND_ENTRY_CANDIDATES.map(async candidate => {
        const resolved = joinPath(root, candidate)
        return (await file(resolved).exists()) ? [resolved] : []
      })
    )
  ).flat()
  if (matches.length <= 1) return matches[0]
  const preferredOnAmbiguous = [joinPath(root, 'ui/src/styles/globals.css')]
  for (const preferred of preferredOnAmbiguous) if (matches.includes(preferred)) return preferred
  const relMatches = matches.map(path => path.slice(root.length + 1))
  throw new Error(
    `Multiple Tailwind entry files found: ${relMatches.join(', ')}. Set eslint.tailwind to an explicit path.`
  )
}
/** The files whose rules need a JavaScript AST. A config that carries JS rules and NO `files` matches every path eslint is handed — harmless while the gate only ever linted JS/TS, and a hard crash the moment a non-JS file type joins the target set, because a type-aware rule then runs against (say) the JSON parser's tree. Every such config is scoped to these. */
const SOURCE_FILE_PATTERNS = ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs', '**/*.ts', '**/*.tsx']
const tailwindRules = (entryPoint?: string): Record<string, Linter.RuleEntry> =>
  entryPoint ? eslintPluginBetterTailwindcss.configs['recommended-error'].rules : {}
/** regexp's `flat/recommended` is the curated set: it keeps every correctness rule (no-super-linear-backtracking — the real ReDoS — plus no-misleading-capturing-group, no-dupe-disjunctions, no-unused-capturing-group) and drops the pure-style ones `flat/all` adds (prefer-named-capture-group, require-unicode-sets-regexp, sort-character-class-elements) and the author-excluded advisory no-super-linear-move. Its rules ship at warn, and a warn enforces nothing because the gate's `warnToError` covers consumer overrides, not a config reached through `extends`, so they are lifted to error here. */
const regexpRecommendedAtError = (): Linter.Config => {
  /** biome-ignore lint/nursery/noUnsafeTypeAssertion: external regexp plugin config is structurally compatible with ESLint's config boundary */
  const rec = regexpConfigs['flat/recommended'] as Linter.Config
  return { ...rec, rules: warnToError(rec.rules ?? {}) }
}
/** package.json is a file type the gate would otherwise never lint. The plugin ships its own `files` glob and JSON parser, so it stands alone rather than riding the TypeScript block. Its `recommended` + `stylistic` are the curated set; the `require-*` family stays out because those demand OPT-IN metadata (`bin`, `browser`, `cpu`, `gypfile`, `libc`, `man`, `os`) that no ordinary package declares. `require-type` is disabled with cause: its autofix stamps `"type": "commonjs"` onto any manifest missing `type`, which silently BREAKS an ESM package (a Next/MDX app relying on extension-based resolution) — a rule that guesses a load-bearing field and defaults it wrong is harm, not strictness. */
const packageJsonConfig = (): Linter.Config => {
  /** biome-ignore lint/nursery/noUnsafeTypeAssertion: external package-json plugin config is structurally compatible with ESLint's config boundary */
  const recommended = packageJsonConfigs.recommended as Linter.Config
  /** biome-ignore lint/nursery/noUnsafeTypeAssertion: external package-json plugin config is structurally compatible with ESLint's config boundary */
  const stylistic = packageJsonConfigs.stylistic as Linter.Config
  return {
    ...recommended,
    rules: {
      ...warnToError({ ...recommended.rules, ...stylistic.rules }),
      'package-json/require-type': 'off',
      'package-json/specify-peers-locally': 'off'
    }
  }
}
interface ReactConfigsParams {
  tailwindEntry: string | undefined
  tailwindSettings: Record<string, unknown>
}
const buildBaseTypescriptConfigs = (): ReturnType<typeof defineConfig> =>
  defineConfig(
    { ...perfectionist['recommended-natural'], files: SOURCE_FILE_PATTERNS },
    { ignores: ['**/postcss.config.mjs'] },
    {
      extends: [
        eslint.configs.recommended,
        eslint.configs.all,
        ...tseslint.configs.all,
        ...tseslint.configs.recommended,
        ...tseslint.configs.recommendedTypeChecked,
        ...tseslint.configs.stylisticTypeChecked,
        eslintReact.configs.all,
        eslintReact.configs['strict-type-checked'],
        eslintReact.configs.recommended,
        eslintReact.configs.dom,
        eslintReact.configs['web-api'],
        eslintReact.configs.jsx,
        eslintReact.configs['naming-convention'],
        eslintReact.configs.rsc,
        regexpRecommendedAtError(),
        sonarjs.configs.recommended,
        erasableSyntaxOnly.configs.recommended
      ],
      files: ['**/*.js', '**/*.ts', '**/*.tsx'],
      plugins: {
        preferArrow,
        turbo
      },
      rules: {
        '@eslint-react/jsx-no-leaked-dollar': 'error',
        '@eslint-react/naming-convention-ref-name': 'error',
        '@eslint-react/no-duplicate-key': 'error',
        '@eslint-react/no-implicit-key': 'error',
        '@eslint-react/no-missing-component-display-name': 'error',
        '@eslint-react/no-missing-context-display-name': 'error',
        '@typescript-eslint/consistent-return': 'off',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'separate-type-imports', prefer: 'type-imports' }
        ],
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/explicit-member-accessibility': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/init-declarations': 'off',
        '@typescript-eslint/naming-convention': [
          'error',
          { format: ['camelCase', 'UPPER_CASE', 'PascalCase'], selector: 'variable' }
        ],
        '@typescript-eslint/no-confusing-void-expression': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
        '@typescript-eslint/no-magic-numbers': 'off',
        '@typescript-eslint/no-misused-promises': [2, { checksVoidReturn: { attributes: false } }],
        '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: true }],
        '@typescript-eslint/no-unsafe-type-assertion': 'off',
        '@typescript-eslint/no-useless-default-assignment': 'off',
        '@typescript-eslint/prefer-destructuring': ['error', { array: false, object: true }],
        '@typescript-eslint/prefer-readonly-parameter-types': 'off',
        '@typescript-eslint/strict-boolean-expressions': 'off',
        camelcase: 'off',
        'capitalized-comments': 'off',
        curly: ['error', 'multi'],
        'id-length': 'off',
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'max-statements': 'off',
        'new-cap': ['error', { capIsNewExceptionPattern: '.*' }],
        'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
        'no-magic-numbers': 'off',
        'no-nested-ternary': 'off',
        'no-ternary': 'off',
        'no-undefined': 'off',
        'no-underscore-dangle': 'off',
        'one-var': ['error', 'never'],
        'perfectionist/sort-imports': ['error', { newlinesBetween: 0, order: 'asc', type: 'natural' }],
        'perfectionist/sort-objects': 'off',
        'perfectionist/sort-variable-declarations': 'off',
        'preferArrow/prefer-arrow-functions': ['error', { returnStyle: 'implicit' }],
        'require-atomic-updates': 'off',
        'sort-imports': 'off',
        'sort-keys': 'off',
        'sort-vars': 'off'
      }
    },
    {
      files: ['**/*.js', '**/*.ts', '**/*.tsx'],
      plugins: eslintReact.configs['strict-type-checked'].plugins,
      rules: {
        ...warnToError({
          ...eslintReact.configs.all.rules,
          ...eslintReact.configs['strict-type-checked'].rules,
          ...eslintReact.configs.recommended.rules,
          ...eslintReact.configs.dom.rules,
          ...eslintReact.configs['web-api'].rules,
          ...eslintReact.configs.jsx.rules,
          ...eslintReact.configs['naming-convention'].rules,
          ...eslintReact.configs.rsc.rules
        }),
        '@eslint-react/dom-no-string-style-prop': 'error',
        '@eslint-react/dom-no-unknown-property': 'error'
      }
    }
  )
const buildReactConfigs = ({ tailwindEntry, tailwindSettings }: ReactConfigsParams): ReturnType<typeof defineConfig> =>
  defineConfig(
    { ...reactHooks.configs.flat['recommended-latest'], files: SOURCE_FILE_PATTERNS },
    {
      files: ['**/*.ts', '**/*.tsx'],
      ...reactPlugin.configs.flat.all,
      ...reactPlugin.configs.flat['jsx-runtime'],
      languageOptions: {
        ...reactPlugin.configs.flat.all?.languageOptions,
        ...reactPlugin.configs.flat['jsx-runtime']?.languageOptions,
        globals: {
          React: 'writable'
        }
      },
      plugins: {
        'better-tailwindcss': eslintPluginBetterTailwindcss,
        react: reactPlugin
      },
      rules: {
        ...reactPlugin.configs['jsx-runtime'].rules,
        ...reactPlugin.configs.all.rules,
        ...tailwindRules(tailwindEntry),
        'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
        'no-restricted-syntax': [
          'error',
          {
            message:
              'Extract the immediately-invoked function in JSX to a named component; it is rebuilt on every render.',
            selector: 'JSXExpressionContainer CallExpression[callee.type=/^(Arrow)?FunctionExpression$/]'
          }
        ],
        'react-hooks/capitalized-calls': 'error',
        'react-hooks/component-hook-factories': 'error',
        'react-hooks/exhaustive-deps': 'error',
        'react-hooks/exhaustive-effect-dependencies': 'error',
        'react-hooks/incompatible-library': 'error',
        'react-hooks/memo-dependencies': 'off',
        'react-hooks/memoized-effect-dependencies': 'error',
        'react-hooks/no-deriving-state-in-effects': 'error',
        'react-hooks/preserve-manual-memoization': 'off',
        'react-hooks/set-state-in-effect': 'off',
        'react-hooks/unsupported-syntax': 'error',
        'react/forbid-component-props': 'off',
        'react/function-component-definition': 'off',
        'react/jsx-child-element-spacing': 'off',
        'react/jsx-closing-bracket-location': 'off',
        'react/jsx-curly-newline': 'off',
        'react/jsx-filename-extension': ['error', { extensions: ['.tsx'] }],
        'react/jsx-handler-names': 'off',
        'react/jsx-indent': 'off',
        'react/jsx-indent-props': 'off',
        'react/jsx-max-depth': 'off',
        'react/jsx-max-props-per-line': 'off',
        'react/jsx-newline': 'off',
        'react/jsx-no-bind': 'off',
        'react/jsx-no-literals': 'off',
        'react/jsx-one-expression-per-line': 'off',
        'react/jsx-props-no-spreading': 'off',
        'react/jsx-sort-props': ['error', { ignoreCase: true }],
        'react/no-multi-comp': 'off',
        'react/prefer-read-only-props': 'off',
        'react/require-default-props': 'off'
      },
      settings: tailwindSettings
    }
  )
const buildNextConfigs = (): ReturnType<typeof defineConfig> =>
  defineConfig({
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@next/next': nextPlugin
    },
    rules: {
      ...warnToError({
        ...nextPlugin.configs.recommended.rules,
        ...nextPlugin.configs['core-web-vitals'].rules
      }),
      '@next/next/no-duplicate-head': 'off',
      '@next/next/no-html-link-for-pages': 'off'
    }
  })
const buildTestFileConfigs = (): ReturnType<typeof defineConfig> =>
  defineConfig({
    files: [...ESLINT_TEST_FILE_PATTERNS],
    rules: {
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/strict-void-return': 'off',
      'no-await-in-loop': 'off',
      'no-control-regex': 'off'
    }
  })
const buildConvexTestConfigs = (): ReturnType<typeof defineConfig> =>
  defineConfig({
    files: ['**/convex/**/*.test.ts', '**/test-utils/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off'
    }
  })
const buildScriptFileConfigs = (): ReturnType<typeof defineConfig> =>
  defineConfig({
    files: ['**/*Script.ts', '**/*.generated.ts'],
    rules: {
      'no-template-curly-in-string': 'off'
    }
  })
const buildAuthConfigConfigs = (): ReturnType<typeof defineConfig> =>
  defineConfig({
    files: ['**/auth.config.js'],
    rules: {
      'no-undef': 'off'
    }
  })
interface AppendOverrideParams {
  appendConfigs: Linter.Config[]
  knownRuleNames: Set<string>
}
interface OffOverrideParams {
  knownRuleNames: Set<string>
  normalizedRules: ReturnType<typeof normalizeRulesOffInput>
}
const buildOffOverrideConfigs = ({ knownRuleNames, normalizedRules }: OffOverrideParams): Linter.Config[] => {
  if (!normalizedRules) return []
  const unknownRules = findUnknownRules({
    knownRules: knownRuleNames,
    rules: normalizedRules
  })
  if (unknownRules.length > 0) throw new Error(`eslint.off contains unknown eslint rules: ${unknownRules.join(', ')}`)
  const overrideRules: Linter.RulesRecord = {}
  for (const [key, value] of Object.entries(normalizedRules)) overrideRules[key] = value
  return [{ rules: overrideRules }]
}
const buildAppendOverrideConfigs = ({ appendConfigs, knownRuleNames }: AppendOverrideParams): Linter.Config[] => {
  const out: Linter.Config[] = []
  for (const config of appendConfigs) {
    const shared = getSharedAppendConfig({ config })
    const unknownRules =
      shared && config.rules
        ? findUnknownRules({
            knownRules: knownRuleNames,
            rules: config.rules
          })
        : []
    if (unknownRules.length > 0)
      throw new Error(`overrides.eslint contains unknown eslint rules: ${unknownRules.join(', ')}`)
    const sanitized: Linter.Config =
      shared === null
        ? config
        : (() => {
            const sanitizedShared: Record<string, unknown> = {}
            if (shared.files !== undefined) sanitizedShared.files = shared.files
            if (shared.rules !== undefined) sanitizedShared.rules = shared.rules
            return sanitizedShared
          })()
    out.push(sanitized.rules ? { ...sanitized, rules: warnToError(sanitized.rules) } : sanitized)
  }
  return out
}
const buildParserOptionsConfigs = ({ root }: { root: string }): Linter.Config[] => [
  {
    files: SOURCE_FILE_PATTERNS,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: root
      }
    }
  },
  { linterOptions: { reportUnusedDisableDirectives: true } }
]
const eslintFactory = async (options?: EslintOptions): Promise<Linter.Config[]> => {
  await validateEslintOptions({ options })
  const opts = options ?? {}
  const root = opts.tsconfigRootDir ?? process.cwd()
  const configs: Parameters<typeof defineConfig> = []
  const gitignorePath = joinPath(root, '.gitignore')
  const normalizedIgnores = normalizePathListInput({
    allowUndefined: true,
    label: 'eslint.ignores',
    value: opts.ignores
  })
  const tailwindEntry = await resolveTailwindEntry({
    root,
    tailwind: opts.tailwind
  })
  const tailwindSettings: Record<string, unknown> = {}
  if (tailwindEntry) tailwindSettings['better-tailwindcss'] = { entryPoint: tailwindEntry }
  configs.push(globalIgnores([...DEFAULT_SHARED_IGNORE_PATTERNS, ...normalizedIgnores]))
  try {
    // eslint-disable-next-line sonarjs/deprecation -- reason: replacement not yet exported (see import)
    configs.push(includeIgnoreFile(gitignorePath))
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      if (!(message.includes('enoent') || message.includes('no such file'))) throw error
    } else throw error
  }
  configs.push(
    packageJsonConfig(),
    ...buildBaseTypescriptConfigs(),
    ...buildReactConfigs({ tailwindEntry, tailwindSettings }),
    ...buildNextConfigs(),
    ...buildTestFileConfigs(),
    ...buildConvexTestConfigs(),
    ...buildScriptFileConfigs(),
    ...buildAuthConfigConfigs()
  )
  const appendConfigs = normalizeAppendInput({ append: opts.append })
  const knownRuleNames = collectKnownEslintRuleNames({
    appendConfigs,
    baseConfigs: configs
  })
  const normalizedRules = normalizeRulesOffInput({
    label: 'eslint.off',
    value: opts.off
  })
  configs.push(
    ...buildOffOverrideConfigs({ knownRuleNames, normalizedRules }),
    ...buildAppendOverrideConfigs({ appendConfigs, knownRuleNames }),
    ...buildParserOptionsConfigs({ root })
  )
  return defineConfig(...configs)
}
const defaultConfig: Linter.Config[] = await eslintFactory()
export type { EslintOptions }
export default defaultConfig
export { eslintFactory as eslint }
