import type { BundledLanguage } from 'shiki'
import { createHighlighter } from 'shiki'
interface HighlightToken {
  color: string
  content: string
  id: string
}
interface TokenLine {
  id: string
  tokens: HighlightToken[]
}
let highlighter: Awaited<ReturnType<typeof createHighlighter>> | null = null
const highlight = async (code: string, lang: BundledLanguage = 'typescript'): Promise<TokenLine[]> => {
  highlighter ??= await createHighlighter({
    langs: ['typescript', 'tsx', 'bash', 'json'],
    themes: ['github-dark']
  })
  const result = highlighter.codeToTokens(code, { lang, theme: 'github-dark' })
  return result.tokens.map((line, li) => ({
    id: `L${li}`,
    tokens: line.map((token, ti) => ({
      color: token.color ?? '#e1e4e8',
      content: token.content,
      id: `L${li}T${ti}`
    }))
  }))
}
export type { TokenLine }
export { highlight }
