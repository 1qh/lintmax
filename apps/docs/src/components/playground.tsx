'use client'
import { useState } from 'react'

interface PlaygroundProps {
  checkOutput: string
  checkTokens: number
  dirtyCode: string
  fixedCode: string
  verboseOutput: string
  verboseTokens: number
}

export const Playground = ({
  checkOutput,
  checkTokens,
  dirtyCode,
  fixedCode,
  verboseOutput,
  verboseTokens,
}: PlaygroundProps) => {
  const [tab, setTab] = useState<'check' | 'fix'>('check')
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div className="flex flex-col gap-4 w-full max-w-4xl mx-auto">
      <div className="rounded-xl border border-fd-border overflow-hidden">
        <div className="bg-fd-card px-4 py-2 border-b border-fd-border flex items-center justify-between">
          <span className="text-sm font-mono text-fd-muted-foreground">dirty-fixture.ts</span>
          <span className="text-xs text-fd-muted-foreground">before lintmax</span>
        </div>
        <pre className="p-4 text-sm font-mono overflow-x-auto bg-black text-neutral-300 max-h-80 overflow-y-auto">
          {dirtyCode}
        </pre>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('check')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'check'
              ? 'bg-fd-primary text-fd-primary-foreground'
              : 'bg-fd-card border border-fd-border text-fd-muted-foreground'
          }`}
        >
          check
        </button>
        <button
          type="button"
          onClick={() => setTab('fix')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'fix'
              ? 'bg-fd-primary text-fd-primary-foreground'
              : 'bg-fd-card border border-fd-border text-fd-muted-foreground'
          }`}
        >
          fix
        </button>
        {tab === 'check' && (
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-fd-card border border-fd-border text-fd-muted-foreground"
          >
            {showRaw ? 'compact output' : 'raw output'}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-fd-border overflow-hidden">
        <div className="bg-fd-card px-4 py-2 border-b border-fd-border flex items-center justify-between">
          <span className="text-sm font-mono text-fd-muted-foreground">
            {tab === 'check' ? '$ lintmax check' : '$ lintmax fix && lintmax check'}
          </span>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-fd-accent text-fd-accent-foreground">
            {tab === 'check'
              ? showRaw
                ? `${verboseTokens.toLocaleString()} tokens`
                : `${checkTokens.toLocaleString()} tokens`
              : '0 tokens'}
          </span>
        </div>
        <pre className="p-4 text-sm font-mono overflow-x-auto bg-black text-neutral-300 max-h-96 overflow-y-auto whitespace-pre-wrap">
          {tab === 'check'
            ? showRaw
              ? verboseOutput
              : checkOutput
            : ''}
        </pre>
        {tab === 'fix' && (
          <div className="border-t border-fd-border">
            <div className="bg-fd-card px-4 py-2 border-b border-fd-border">
              <span className="text-sm font-mono text-fd-muted-foreground">fixed file</span>
            </div>
            <pre className="p-4 text-sm font-mono overflow-x-auto bg-black text-green-400 max-h-80 overflow-y-auto">
              {fixedCode}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
