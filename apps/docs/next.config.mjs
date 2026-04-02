import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  serverExternalPackages: ['@biomejs/biome', 'oxlint'],
  outputFileTracingIncludes: {
    '/api/lint': [
      './node_modules/@biomejs/biome/**/*',
      './node_modules/@biomejs/cli-linux-x64/**/*',
      './node_modules/@biomejs/cli-linux-arm64/**/*',
      './node_modules/oxlint/**/*',
      './node_modules/@oxlint/linux-x64-gnu/**/*',
      './node_modules/@oxlint/linux-arm64-gnu/**/*',
    ],
  },
}

export default withMDX(config)
