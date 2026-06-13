import type { SyncOptions } from 'lintmax'

export default {
  biome: {
    overrides: [{ includes: ['**/package.json', '**/src/eslint.ts'], off: ['noRestrictedDependencies'] }]
  }
} satisfies SyncOptions
