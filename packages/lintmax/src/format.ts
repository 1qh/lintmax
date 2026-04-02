import type { GroupedFile } from './aggregate.js'
const formatGrouped = ({ files }: { files: GroupedFile[] }): string => {
  if (files.length === 0) return ''
  const parts: string[] = []
  for (const f of files) {
    parts.push(f.file)
    for (const l of f.linters) {
      parts.push(` ${l.linter}`)
      for (const r of l.rules) {
        const lineStr = r.lines.length > 0 ? r.lines.join(',') : ''
        parts.push(`  ${lineStr}${lineStr.length > 0 ? ' ' : ''}${r.rule}`)
      }
    }
  }
  return parts.join('\n')
}
export { formatGrouped }
