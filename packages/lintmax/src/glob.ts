import type { Glob } from 'bun'
const doesMatchGlob = (glob: Glob, path: string): boolean => glob.match(path)
export { doesMatchGlob }
