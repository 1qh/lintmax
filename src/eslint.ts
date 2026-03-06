/// <reference types="./types.d.ts" />

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
import { isAbsolute, join } from 'node:path'
import tseslint from 'typescript-eslint'

import type { EslintOptions } from './index.js'

import { warnToError } from './index.js'

interface LintmaxOptions extends EslintOptions {
  append?: Linter.Config[]
}

const tailwindRules = (entryPoint?: string): Record<string, Linter.RuleEntry> =>
  entryPoint ? eslintPluginBetterTailwindcss.configs['recommended-error'].rules : {}

const eslintFactory = (options?: LintmaxOptions): ReturnType<typeof defineConfig> => {
  const opts = options ?? {},
    root = opts.tsconfigRootDir ?? process.cwd(),
    configs: Parameters<typeof defineConfig> = [],
    gitignorePath = join(root, '.gitignore'),
    tailwindEntry = opts.tailwind && (isAbsolute(opts.tailwind) ? opts.tailwind : join(root, opts.tailwind)),
    tailwindSettings: Record<string, unknown> = {}

  if (tailwindEntry)
    tailwindSettings['better-tailwindcss'] = { entryPoint: tailwindEntry }

  if (opts.ignores)
    configs.push(globalIgnores(opts.ignores))

  configs.push(
    ...defineConfig(
      includeIgnoreFile(gitignorePath),
      perfectionist['recommended-natural'],
      { ignores: ['postcss.config.mjs'] },
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
          '@typescript-eslint/prefer-readonly-parameter-types': 'off',
          '@typescript-eslint/strict-boolean-expressions': 'off',
          camelcase: 'off',
          'capitalized-comments': ['error', 'always', { ignorePattern: 'oxlint|biome|console|let|const|return|if|for|throw' }],
          curly: ['error', 'multi'],
          'id-length': 'off',
          'max-lines': 'off',
          'max-lines-per-function': 'off',
          'new-cap': ['error', { capIsNewExceptionPattern: '.*' }],
          'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
          'no-magic-numbers': 'off',
          'no-nested-ternary': 'off',
          'no-ternary': 'off',
          'no-undefined': 'off',
          'no-underscore-dangle': 'off',
          'one-var': ['error', 'consecutive'],
          'perfectionist/sort-variable-declarations': 'off',
          'preferArrow/prefer-arrow-functions': ['error', { returnStyle: 'implicit' }],
          'sort-imports': 'off',
          'sort-keys': 'off',
          'sort-vars': 'off'
        }
      },
      {
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
    ...defineConfig(reactHooks.configs.flat['recommended-latest'] as { rules: Linter.RulesRecord }, {
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
        '@next/next/no-duplicate-head': 'off'
      }
    })
  )

  if (opts.rules) {
    const overrideRules: Linter.RulesRecord = {}
    for (const [key, value] of Object.entries(opts.rules))
      overrideRules[key] = value

    configs.push({ rules: overrideRules })
  }

  if (opts.append)
    for (const config of opts.append)
      configs.push(config)

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

export type { LintmaxOptions }
export default defaultConfig
export { eslintFactory as eslint, warnToError }
