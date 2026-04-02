import { createHighlighter } from 'shiki'

let highlighter: Awaited<ReturnType<typeof createHighlighter>> | null = null

export const highlight = async (code: string, lang = 'typescript') => {
  if (!highlighter) {
    highlighter = await createHighlighter({
      themes: ['github-dark'],
      langs: ['typescript', 'tsx', 'bash', 'json'],
    })
  }
  return highlighter.codeToHtml(code, {
    lang,
    theme: 'github-dark',
  })
}
