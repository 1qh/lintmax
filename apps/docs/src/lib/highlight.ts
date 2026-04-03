import { createHighlighter } from 'shiki'
let highlighter: Awaited<ReturnType<typeof createHighlighter>> | null = null
export const highlight = async (code: string, lang = 'typescript') => {
  if (!highlighter)
    highlighter = await createHighlighter({
      langs: ['typescript', 'tsx', 'bash', 'json'],
      themes: ['github-dark']
    })
  return highlighter.codeToHtml(code, {
    lang,
    theme: 'github-dark'
  })
}
