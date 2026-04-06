import { defineConfig } from 'tsdown'
export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/cli.ts', 'src/eslint.ts'],
  format: 'esm',
  outDir: 'dist'
})
