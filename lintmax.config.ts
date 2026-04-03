import { defineConfig } from 'lintmax'
export default defineConfig({
  biome: {
    off: [
      'noImportantStyles',
      'noDangerouslySetInnerHtml',
      'noLeakedRender',
      'noShadow',
      'useBaseline',
      'useConsistentCurlyBraces',
      'useExportsLast'
    ]
  },
  eslint: {
    off: [
      '@eslint-react/dom/no-dangerously-set-innerhtml',
      '@typescript-eslint/no-shadow',
      '@typescript-eslint/no-unnecessary-condition',
      '@typescript-eslint/prefer-nullish-coalescing',
      '@typescript-eslint/strict-void-return',
      'react/destructuring-assignment',
      'react/jsx-pascal-case',
      'react/no-danger',
      'require-atomic-updates'
    ]
  }
})
