import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="flex flex-col justify-center text-center flex-1 gap-6 px-4">
      <h1 className="text-4xl font-bold tracking-tight">lintmax</h1>
      <p className="text-lg text-fd-muted-foreground max-w-lg mx-auto">
        Anti AI slop. Combines biome, oxlint, eslint, prettier, and
        sort-package-json. Token-efficient output for agents, verbose for
        humans.
      </p>
      <div className="flex gap-3 justify-center">
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary text-fd-primary-foreground px-6 py-2.5 font-medium text-sm"
        >
          Get Started
        </Link>
        <Link
          href="/docs/output-format"
          className="rounded-lg border border-fd-border px-6 py-2.5 font-medium text-sm"
        >
          Output Format
        </Link>
      </div>
      <pre className="text-left text-sm bg-fd-card border border-fd-border rounded-xl p-6 max-w-2xl mx-auto w-full overflow-x-auto font-mono">
        {`$ lintmax check
src/utils.ts
 biome
  42,55,60 lint/suspicious/noExplicitAny
  1312 lint/correctness/noChildrenProp
 eslint
  1184,1209 @typescript-eslint/no-unsafe-call
 comments
  1,5,12 deletable`}
      </pre>
      <p className="text-sm text-fd-muted-foreground">
        93% fewer tokens than raw linter output
      </p>
    </div>
  )
}
