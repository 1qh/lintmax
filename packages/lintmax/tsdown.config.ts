import { defineConfig } from 'tsdown'
export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/eslint.ts', 'src/cli.ts'],
  format: 'esm',
  outDir: 'dist'
})
