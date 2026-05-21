/* eslint-disable @typescript-eslint/no-deprecated */
import type { Linter } from 'eslint'
import eslintReact from '@eslint-react/eslint-plugin'
import { includeIgnoreFile } from '@eslint/compat'
import eslint from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import eslintPluginBetterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { configs as perfectionist } from 'eslint-plugin-perfectionist'
import preferArrow from 'eslint-plugin-prefer-arrow-functions'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import turbo from 'eslint-plugin-turbo'
import { defineConfig, globalIgnores } from 'eslint/config'
import { existsSync } from 'node:fs'
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
const validateEslintOptions = ({ options }: { options?: EslintOptions }) => {
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
    if (!existsSync(resolved))
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
  const raw = config as Record<PropertyKey, unknown>
  return raw[sharedOverrideMarker] === true ? (config as SharedOverrideAppendConfig) : null
}
const resolveTailwindEntry = ({
  root,
  tailwind
}: {
  root: string
  tailwind: boolean | string | undefined
}): string | undefined => {
  const tailwindSetting = tailwind ?? true
  if (tailwindSetting === false) return
  if (typeof tailwindSetting === 'string')
    return isAbsolutePath(tailwindSetting) ? tailwindSetting : joinPath(root, tailwindSetting)
  const matches: string[] = []
  for (const candidate of TAILWIND_ENTRY_CANDIDATES) {
    const resolved = joinPath(root, candidate)
    if (existsSync(resolved)) matches.push(resolved)
  }
  if (matches.length <= 1) return matches[0]
  const preferredOnAmbiguous = [joinPath(root, 'ui/src/styles/globals.css')]
  for (const preferred of preferredOnAmbiguous) if (matches.includes(preferred)) return preferred
  const relMatches = matches.map(path => path.slice(root.length + 1))
  throw new Error(
    `Multiple Tailwind entry files found: ${relMatches.join(', ')}. Set eslint.tailwind to an explicit path.`
  )
}
const tailwindRules = (entryPoint?: string): Record<string, Linter.RuleEntry> =>
  entryPoint ? eslintPluginBetterTailwindcss.configs['recommended-error'].rules : {}
const eslintFactory = (options?: EslintOptions): ReturnType<typeof defineConfig> => {
  validateEslintOptions({ options })
  const opts = options ?? {}
  const root = opts.tsconfigRootDir ?? process.cwd()
  const configs: Parameters<typeof defineConfig> = []
  const gitignorePath = joinPath(root, '.gitignore')
  const normalizedIgnores = normalizePathListInput({
    allowUndefined: true,
    label: 'eslint.ignores',
    value: opts.ignores
  })
  const tailwindEntry = resolveTailwindEntry({
    root,
    tailwind: opts.tailwind
  })
  const tailwindSettings: Record<string, unknown> = {}
  if (tailwindEntry) tailwindSettings['better-tailwindcss'] = { entryPoint: tailwindEntry }
  configs.push(globalIgnores([...DEFAULT_SHARED_IGNORE_PATTERNS, ...normalizedIgnores]))
  try {
    configs.push(includeIgnoreFile(gitignorePath))
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      if (!(message.includes('enoent') || message.includes('no such file'))) throw error
    } else throw error
  }
  configs.push(
    ...defineConfig(
      perfectionist['recommended-natural'],
      { ignores: ['**/postcss.config.mjs'] },
      {
        extends: [
          eslint.configs.recommended,
          eslint.configs.all,
          ...tseslint.configs.all,
          ...tseslint.configs.recommended,
          ...tseslint.configs.recommendedTypeChecked,
          ...tseslint.configs.stylisticTypeChecked,
          eslintReact.configs['strict-type-checked'],
          eslintReact.configs.recommended
        ],
        files: ['**/*.js', '**/*.ts', '**/*.tsx'],
        plugins: {
          preferArrow,
          turbo
        },
        rules: {
          '@eslint-react/avoid-shorthand-boolean': 'off',
          '@eslint-react/avoid-shorthand-fragment': 'off',
          '@eslint-react/jsx-dollar': 'error',
          '@eslint-react/jsx-shorthand-boolean': 'error',
          '@eslint-react/jsx-shorthand-fragment': 'error',
          '@eslint-react/naming-convention/component-name': 'error',
          '@eslint-react/naming-convention/ref-name': 'error',
          '@eslint-react/no-duplicate-key': 'error',
          '@eslint-react/no-missing-component-display-name': 'error',
          '@eslint-react/no-missing-context-display-name': 'off',
          '@eslint-react/no-unnecessary-key': 'error',
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
          'capitalized-comments': [
            'error',
            'always',
            { ignorePattern: 'oxlint|biome|console|let|const|return|if|for|throw' }
          ],
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
        plugins: (eslintReact.configs['strict-type-checked'] as Linter.Config).plugins,
        rules: {
          ...warnToError({
            ...eslintReact.configs['strict-type-checked'].rules,
            ...eslintReact.configs.recommended.rules
          }),
          '@eslint-react/dom/no-string-style-prop': 'error',
          '@eslint-react/dom/no-unknown-property': 'error',
          '@eslint-react/jsx-no-undef': 'error'
        }
      }
    ),
    ...defineConfig(reactHooks.configs.flat['recommended-latest'], {
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
        'react-hooks/exhaustive-deps': 'error',
        'react-hooks/incompatible-library': 'error',
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
    }),
    ...defineConfig({
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
    }),
    ...defineConfig({
      files: [...ESLINT_TEST_FILE_PATTERNS],
      rules: {
        '@typescript-eslint/await-thenable': 'off',
        '@typescript-eslint/no-misused-promises': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/strict-void-return': 'off',
        'no-await-in-loop': 'off',
        'no-control-regex': 'off'
      }
    }),
    ...defineConfig({
      files: ['**/convex/**/*.test.ts', '**/test-utils/**/*.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-return': 'off'
      }
    }),
    ...defineConfig({
      files: ['**/*Script.ts', '**/*.generated.ts'],
      rules: {
        'no-template-curly-in-string': 'off'
      }
    }),
    ...defineConfig({
      files: ['**/auth.config.js'],
      rules: {
        'no-undef': 'off'
      }
    })
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
  if (normalizedRules) {
    const unknownRules = findUnknownRules({
      knownRules: knownRuleNames,
      rules: normalizedRules
    })
    if (unknownRules.length > 0) throw new Error(`eslint.off contains unknown eslint rules: ${unknownRules.join(', ')}`)
    const overrideRules: Linter.RulesRecord = {}
    for (const [key, value] of Object.entries(normalizedRules)) overrideRules[key] = value
    configs.push({ rules: overrideRules })
  }
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
            const out: Record<string, unknown> = {}
            if (shared.files !== undefined) out.files = shared.files
            if (shared.rules !== undefined) out.rules = shared.rules
            return out
          })()
    configs.push(sanitized.rules ? { ...sanitized, rules: warnToError(sanitized.rules) } : sanitized)
  }
  configs.push({
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: root
      }
    },
    linterOptions: { reportUnusedDisableDirectives: true }
  })
  return defineConfig(...configs)
}
const defaultConfig = eslintFactory()
export type { EslintOptions }
export default defaultConfig
export { eslintFactory as eslint }
