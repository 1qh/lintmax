import { source } from '@/lib/source'

export const GET = () => {
  const pages = source.getPages()
  const lines = [
    '# lintmax',
    '',
    'The #1 anti AI slop typescript tooling. Designed for coding agents, not humans.',
    '',
    '## Pages',
    '',
    ...pages.map(page => `- [${page.data.title}](https://lintmax.vercel.app${page.url}): ${page.data.description ?? ''}`)
  ]
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
