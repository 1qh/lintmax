import type { Linter } from 'eslint'
interface BiomeOptions {
  ignores?: PathListInput
  off?: RulesOffInput
  overrides?: {
    includes: PathListInput
    off: RulesOffInput
  }[]
}
interface EslintOptions {
  append?: Linter.Config[]
  ignores?: PathListInput
  off?: RulesOffInput
  tailwind?: TailwindOption
  tsconfigRootDir?: string
}
interface JsonObject {
  [key: string]: JsonValue
}
type JsonPrimitive = boolean | null | number | string
type JsonValue = JsonObject | JsonPrimitive | JsonValue[]
interface OxlintOptions {
  ignores?: PathListInput
  off?: RulesOffInput
  overrides?: {
    files: PathListInput
    off: RulesOffInput
  }[]
}
type PathListInput = readonly string[]
type RulesOffInput = readonly string[]
type SharedOverrideMapRuleOptions =
  | {
      biome: RulesOffInput
      eslint?: RulesOffInput
      oxlint?: RulesOffInput
    }
  | {
      biome?: RulesOffInput
      eslint: RulesOffInput
      oxlint?: RulesOffInput
    }
  | {
      biome?: RulesOffInput
      eslint?: RulesOffInput
      oxlint: RulesOffInput
    }
interface SyncOptions {
  biome?: BiomeOptions
  compact?: boolean
  eslint?: Omit<EslintOptions, 'append' | 'tailwind' | 'tsconfigRootDir'> & { append?: readonly JsonObject[] }
  ignores?: PathListInput
  overrides?: Record<string, SharedOverrideMapRuleOptions>
  oxlint?: OxlintOptions
  tailwind?: TailwindOption
  tsconfigRootDir?: string
}
type TailwindOption = boolean | string
export type {
  BiomeOptions,
  EslintOptions,
  OxlintOptions,
  PathListInput,
  RulesOffInput,
  SharedOverrideMapRuleOptions,
  SyncOptions,
  TailwindOption
}
