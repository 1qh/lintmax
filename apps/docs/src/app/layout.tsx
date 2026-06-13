import type { Metadata } from 'next'
import { mono, sans } from './fonts'
import './global.css'
import { Providers } from './providers'

const metadata: Metadata = {
  title: 'lintmax docs'
}
const fonts = [sans.variable, mono.variable, 'font-sans', 'tracking-[-0.02em]'].join(' ')
const Layout = ({ children }: LayoutProps<'/'>) => (
  <html className={fonts} lang='en' suppressHydrationWarning>
    {/* biome-ignore lint/nursery/noUndeclaredClasses: standard tailwind v4 utilities biome cannot resolve */}
    <body className='flex flex-col min-h-screen antialiased'>
      <Providers>{children}</Providers>
    </body>
  </html>
)
export { metadata }
export default Layout
