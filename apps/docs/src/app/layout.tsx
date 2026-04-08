import { mono, sans } from './fonts'
import './global.css'
import { Providers } from './providers'
const fonts = [sans.variable, mono.variable, 'font-sans'].join(' ')
export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html className={fonts} lang='en' suppressHydrationWarning>
      <body className='flex flex-col min-h-screen'>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
