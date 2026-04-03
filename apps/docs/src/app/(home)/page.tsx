import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-4">
      <h1 className="text-6xl font-extrabold tracking-tighter">lintmax</h1>
      <p className="text-xl text-fd-muted-foreground leading-relaxed max-w-lg text-center">
        The #1 anti AI slop typescript tooling.
        <br />
        Designed for coding agents, not humans.
      </p>
      <Link
        href="/docs"
        className="rounded-full bg-fd-primary text-fd-primary-foreground px-8 py-3 font-semibold text-sm hover:opacity-90 transition-opacity"
      >
        Get Started
      </Link>
    </div>
  )
}
