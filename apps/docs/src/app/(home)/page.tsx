import Link from 'next/link'
import { Playground } from '@/components/playground'
import {
  checkOutput,
  checkTokens,
  dirtyCode,
  fixedCode,
  verboseOutput,
  verboseTokens,
} from '@/lib/fixture-data'

export default function HomePage() {
  return (
    <div className="flex flex-col items-center gap-16 px-4 py-20">
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-6xl font-extrabold tracking-tighter">lintmax</h1>
        <p className="text-xl text-fd-muted-foreground max-w-md">
          One command. Every linter. 93% fewer tokens.
        </p>
        <div className="flex gap-3">
          <Link
            href="/docs"
            className="rounded-full bg-fd-primary text-fd-primary-foreground px-8 py-3 font-semibold text-sm"
          >
            Get Started
          </Link>
          <Link
            href="https://github.com/1qh/lintmax"
            className="rounded-full border border-fd-border px-8 py-3 font-semibold text-sm"
          >
            GitHub
          </Link>
        </div>
      </div>

      <Playground
        checkOutput={checkOutput}
        checkTokens={checkTokens}
        dirtyCode={dirtyCode}
        fixedCode={fixedCode}
        verboseOutput={verboseOutput}
        verboseTokens={verboseTokens}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full">
        <div className="rounded-xl border border-fd-border p-6 bg-fd-card">
          <p className="font-semibold mb-2">Agent-first</p>
          <p className="text-sm text-fd-muted-foreground">
            Grouped output designed for LLM consumption. Zero output on success.
          </p>
        </div>
        <div className="rounded-xl border border-fd-border p-6 bg-fd-card">
          <p className="font-semibold mb-2">Comment deletion</p>
          <p className="text-sm text-fd-muted-foreground">
            Strips slop comments automatically. Keeps JSDoc, lint directives, and shebangs.
          </p>
        </div>
        <div className="rounded-xl border border-fd-border p-6 bg-fd-card">
          <p className="font-semibold mb-2">1,600 rules</p>
          <p className="text-sm text-fd-muted-foreground">
            Cross-linter dedup means no duplicate reports. Biome &gt; oxlint &gt; eslint priority.
          </p>
        </div>
      </div>
    </div>
  )
}
