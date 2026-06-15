import { source } from '@/lib/source'

export const GET = async () => {
  const pages = source.getPages()
  const sections: string[] = [
    '# lintmax',
    '',
    'The #1 anti AI slop typescript tooling. Designed for coding agents, not humans.',
    ''
  ]
  const contents = await Promise.all(pages.map(async page => page.data.getText('processed')))
  for (const [i, page] of pages.entries()) sections.push(`## ${page.data.title}`, '', contents[i] ?? '', '')

  return new Response(sections.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
