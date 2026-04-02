import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  serverExternalPackages: ['@biomejs/biome', 'oxlint'],
  outputFileTracingIncludes: {
    '/api/lint': ['./node_modules/.bin/*', './node_modules/@biomejs/**/*', './node_modules/oxlint/**/*', './node_modules/@oxlint/**/*'],
  },
}

export default withMDX(config)
