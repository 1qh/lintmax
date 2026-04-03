import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-6 px-4 py-24 text-center">
      <h1 className="text-6xl font-extrabold tracking-tighter">lintmax</h1>
      <p className="text-xl text-fd-muted-foreground leading-relaxed max-w-lg">
        The #1 anti AI slop typescript tooling.
        <br />
        Designed for coding agents, not humans.
      </p>
      <div className="flex gap-3 mt-2">
        <Link
          href="/docs"
          className="rounded-full bg-fd-primary text-fd-primary-foreground px-8 py-3 font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Get Started
        </Link>
        <Link
          href="https://github.com/1qh/lintmax"
          className="rounded-full border border-fd-border px-8 py-3 font-semibold text-sm hover:bg-fd-accent transition-colors"
        >
          GitHub
        </Link>
      </div>
    </div>
  )
}
