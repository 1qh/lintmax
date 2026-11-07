import type { Glob } from 'bun'
const matchesGlob = (glob: Glob, path: string): boolean => glob.match(path)
export { matchesGlob }
