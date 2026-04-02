'use client'
import { useState } from 'react'

interface PlaygroundProps {
  checkOutput: string
  checkTokens: number
  dirtyCodeHtml: string
  fixedCodeHtml: string
  verboseOutput: string
  verboseTokens: number
}

export const Playground = ({
  checkOutput,
  checkTokens,
  dirtyCodeHtml,
  fixedCodeHtml,
  verboseOutput,
  verboseTokens,
}: PlaygroundProps) => {
  const [tab, setTab] = useState<'check' | 'fix'>('check')
  const [showRaw, setShowRaw] = useState(false)

  const tokens = tab === 'check' ? (showRaw ? verboseTokens : checkTokens) : 0
  const reduction = Math.round((1 - checkTokens / verboseTokens) * 100)

  return (
    <div className="flex flex-col gap-3 w-full max-w-4xl mx-auto">
      <div className="rounded-xl border border-fd-border overflow-hidden">
        <div className="px-4 py-2 border-b border-fd-border flex items-center justify-between bg-fd-card">
          <span className="text-xs font-mono text-fd-muted-foreground">before</span>
        </div>
        <div
          className="p-4 text-[13px] leading-relaxed font-mono overflow-x-auto max-h-72 overflow-y-auto [&_pre]:!bg-transparent [&_code]:!bg-transparent"
          dangerouslySetInnerHTML={{ __html: dirtyCodeHtml }}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setTab('check'); setShowRaw(false) }}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            tab === 'check' && !showRaw
              ? 'bg-fd-primary text-fd-primary-foreground'
              : 'border border-fd-border text-fd-muted-foreground hover:text-fd-foreground'
          }`}
        >
          lintmax check
        </button>
        <button
          type="button"
          onClick={() => { setTab('check'); setShowRaw(true) }}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            tab === 'check' && showRaw
              ? 'bg-fd-primary text-fd-primary-foreground'
              : 'border border-fd-border text-fd-muted-foreground hover:text-fd-foreground'
          }`}
        >
          raw output
        </button>
        <button
          type="button"
          onClick={() => setTab('fix')}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            tab === 'fix'
              ? 'bg-fd-primary text-fd-primary-foreground'
              : 'border border-fd-border text-fd-muted-foreground hover:text-fd-foreground'
          }`}
        >
          lintmax fix
        </button>
        <span className="ml-auto text-xs font-mono px-3 py-1 rounded-full bg-fd-accent text-fd-accent-foreground">
          {tokens === 0 ? 'exit 0' : `~${tokens} tokens`}
          {tab === 'check' && !showRaw && ` (${reduction}% smaller)`}
        </span>
      </div>

      <div className="rounded-xl border border-fd-border overflow-hidden">
        <div className="px-4 py-2 border-b border-fd-border flex items-center justify-between bg-fd-card">
          <span className="text-xs font-mono text-fd-muted-foreground">
            {tab === 'fix' ? 'after' : 'output'}
          </span>
        </div>
        {tab === 'fix' ? (
          <div
            className="p-4 text-[13px] leading-relaxed font-mono overflow-x-auto max-h-72 overflow-y-auto [&_pre]:!bg-transparent [&_code]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: fixedCodeHtml }}
          />
        ) : (
          <pre className="p-4 text-[13px] leading-relaxed font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap text-neutral-400">
            {showRaw ? verboseOutput : checkOutput}
          </pre>
        )}
      </div>
    </div>
  )
}
