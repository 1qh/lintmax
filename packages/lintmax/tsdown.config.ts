import { defineConfig } from 'tsdown'
export default defineConfig({
  clean: true,
  deps: { neverBundle: ['bun'] },
  dts: true,
  entry: ['src/index.ts', 'src/eslint.ts', 'src/cli.ts'],
  format: 'esm',
  outDir: 'dist'
})
