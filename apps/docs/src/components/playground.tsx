'use client'
import { useMemo, useState } from 'react'
import type { TokenLine } from '@/lib/highlight'
interface PlaygroundProps {
  checkOutput: string
  checkTokens: number
  dirtyCodeTokens: TokenLine[]
  fixedCodeTokens: TokenLine[]
  verboseOutput: string
  verboseTokens: number
}
const CodeBlock = ({ lines }: { lines: TokenLine[] }) => {
  const styleMap = useMemo(() => {
    const map = new Map<string, React.CSSProperties>()
    for (const line of lines)
      for (const token of line.tokens) if (!map.has(token.color)) map.set(token.color, { color: token.color })
    return map
  }, [lines])
  return (
    <pre className='p-4 text-[13px] leading-relaxed font-mono overflow-x-auto max-h-72 overflow-y-auto'>
      <code>
        {lines.map(line => (
          <span key={line.id}>
            {line.tokens.map(token => (
              <span key={token.id} style={styleMap.get(token.color)}>
                {token.content}
              </span>
            ))}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  )
}
const Playground = ({
  checkOutput,
  checkTokens,
  dirtyCodeTokens,
  fixedCodeTokens,
  verboseOutput,
  verboseTokens
}: PlaygroundProps) => {
  const [tab, setTab] = useState<'check' | 'fix'>('check')
  const [showRaw, setShowRaw] = useState(false)
  const [tryMode, setTryMode] = useState(false)
  const [userCode, setUserCode] = useState('')
  const [userOutput, setUserOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const tokens = tab === 'check' ? (showRaw ? verboseTokens : checkTokens) : 0
  const reduction = Math.round((1 - checkTokens / verboseTokens) * 100)
  const handleSubmit = () => {
    if (userCode.trim() && !loading) {
      setLoading(true)
      setUserOutput('')
      const run = async () => {
        try {
          const res = await fetch('/api/lint', {
            body: JSON.stringify({ code: userCode }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST'
          })
          const data = (await res.json()) as { error?: string; exitCode?: number; output?: string }
          if (data.error) setUserOutput(data.error)
          else if (data.exitCode === 0) setUserOutput('exit 0 — no issues found')
          else setUserOutput(data.output ?? '')
        } catch {
          setUserOutput('Request failed')
        } finally {
          setLoading(false)
        }
      }
      run()
    }
  }
  if (tryMode)
    return (
      <div className='flex flex-col gap-3 w-full max-w-4xl mx-auto'>
        <div className='flex items-center gap-2'>
          <button
            className='px-4 py-1.5 rounded-full text-xs font-semibold border border-fd-border text-fd-muted-foreground hover:text-fd-foreground transition-colors'
            onClick={() => setTryMode(false)}
            type='button'>
            &larr; back to demo
          </button>
        </div>
        <div className='rounded-xl border border-fd-border overflow-hidden'>
          <div className='px-4 py-2 border-b border-fd-border bg-fd-card'>
            <span className='text-xs font-mono text-fd-muted-foreground'>paste TypeScript</span>
          </div>
          <textarea
            className='w-full h-64 p-4 text-[13px] leading-relaxed font-mono bg-transparent text-fd-foreground resize-none focus:outline-none'
            onChange={e => setUserCode(e.target.value)}
            placeholder='const x: any = 1&#10;export { x }'
            spellCheck={false}
            value={userCode}
          />
        </div>
        <button
          className='self-start px-6 py-2 rounded-full text-sm font-semibold bg-fd-primary text-fd-primary-foreground disabled:opacity-50 transition-opacity'
          disabled={loading || !userCode.trim()}
          onClick={handleSubmit}
          type='button'>
          {loading ? 'checking...' : 'lintmax check'}
        </button>
        {userOutput ? (
          <div className='rounded-xl border border-fd-border overflow-hidden'>
            <div className='px-4 py-2 border-b border-fd-border bg-fd-card'>
              <span className='text-xs font-mono text-fd-muted-foreground'>output</span>
            </div>
            <pre className='p-4 text-[13px] leading-relaxed font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap text-neutral-400'>
              {userOutput}
            </pre>
          </div>
        ) : null}
      </div>
    )
  return (
    <div className='flex flex-col gap-3 w-full max-w-4xl mx-auto'>
      <div className='rounded-xl border border-fd-border overflow-hidden'>
        <div className='px-4 py-2 border-b border-fd-border flex items-center justify-between bg-fd-card'>
          <span className='text-xs font-mono text-fd-muted-foreground'>before</span>
          <button
            className='text-xs font-medium text-fd-muted-foreground hover:text-fd-foreground transition-colors'
            onClick={() => setTryMode(true)}
            type='button'>
            try your own code &rarr;
          </button>
        </div>
        <CodeBlock lines={dirtyCodeTokens} />
      </div>
      <div className='flex items-center gap-2'>
        <button
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            tab === 'check' && !showRaw
              ? 'bg-fd-primary text-fd-primary-foreground'
              : 'border border-fd-border text-fd-muted-foreground hover:text-fd-foreground'
          }`}
          onClick={() => {
            setTab('check')
            setShowRaw(false)
          }}
          type='button'>
          lintmax check
        </button>
        <button
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            tab === 'check' && showRaw
              ? 'bg-fd-primary text-fd-primary-foreground'
              : 'border border-fd-border text-fd-muted-foreground hover:text-fd-foreground'
          }`}
          onClick={() => {
            setTab('check')
            setShowRaw(true)
          }}
          type='button'>
          raw output
        </button>
        <button
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            tab === 'fix'
              ? 'bg-fd-primary text-fd-primary-foreground'
              : 'border border-fd-border text-fd-muted-foreground hover:text-fd-foreground'
          }`}
          onClick={() => setTab('fix')}
          type='button'>
          lintmax fix
        </button>
        <span className='ml-auto text-xs font-mono px-3 py-1 rounded-full bg-fd-accent text-fd-accent-foreground'>
          {tokens > 0 ? `~${tokens} tokens` : 'exit 0'}
          {tab === 'check' && !showRaw ? ` (${reduction}% smaller)` : null}
        </span>
      </div>
      <div className='rounded-xl border border-fd-border overflow-hidden'>
        <div className='px-4 py-2 border-b border-fd-border bg-fd-card'>
          <span className='text-xs font-mono text-fd-muted-foreground'>{tab === 'fix' ? 'after' : 'output'}</span>
        </div>
        {tab === 'fix' ? (
          <CodeBlock lines={fixedCodeTokens} />
        ) : (
          <pre className='p-4 text-[13px] leading-relaxed font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap text-neutral-400'>
            {showRaw ? verboseOutput : checkOutput}
          </pre>
        )}
      </div>
    </div>
  )
}
export { Playground }
