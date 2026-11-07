import { Button } from '@a/ui/button'
import Link from 'next/link'
const docsLink = <Link href='/docs' />
const Page = () => (
  <div className='flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden px-4'>
    <h1 className='text-6xl font-extrabold tracking-tighter'>lintmax</h1>
    <p className='text-muted-foreground max-w-lg text-center text-xl leading-relaxed'>
      The #1 anti AI slop typescript tooling.
      <br />
      Designed for coding agents, not humans.
    </p>
    <Button nativeButton={false} render={docsLink} size='lg'>
      Get Started
    </Button>
  </div>
)
export default Page
