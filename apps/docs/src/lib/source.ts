import type { InferPageType } from 'fumadocs-core/source'
import { docs } from 'collections/server'
import { loader } from 'fumadocs-core/source'
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons'
import { docsImageRoute, docsRoute } from './shared'
export const source = loader({
  baseUrl: docsRoute,
  plugins: [lucideIconsPlugin()],
  source: docs.toFumadocsSource()
})
export const getPageImage = (page: InferPageType<typeof source>) => {
  const segments = [...page.slugs, 'image.png']
  return {
    segments,
    url: `${docsImageRoute}/${segments.join('/')}`
  }
}
