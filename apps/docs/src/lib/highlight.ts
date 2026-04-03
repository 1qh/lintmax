import type { BundledLanguage } from 'shiki'
import { createHighlighter } from 'shiki'
interface TokenLine {
  tokens: { color: string; content: string }[]
}
let highlighter: Awaited<ReturnType<typeof createHighlighter>> | null = null
const highlight = async (code: string, lang: BundledLanguage = 'typescript'): Promise<TokenLine[]> => {
  highlighter ??= await createHighlighter({
    langs: ['typescript', 'tsx', 'bash', 'json'],
    themes: ['github-dark']
  })
  const result = highlighter.codeToTokens(code, { lang, theme: 'github-dark' })
  return result.tokens.map(line => ({
    tokens: line.map(token => ({
      color: token.color ?? '#e1e4e8',
      content: token.content
    }))
  }))
}
export type { TokenLine }
export { highlight }
