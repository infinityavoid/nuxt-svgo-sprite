import { addTemplate, addServerPlugin } from '@nuxt/kit'
import type { SpriteCollection } from '../types/types'

/**
 * Generates a Nitro server plugin that injects sprite SVGs into html.bodyPrepend
 * via the render:html hook. Sprites appear before #__nuxt so Vue hydration never
 * touches them — no hydration mismatch, and they persist across SPA navigation.
 *
 * getContents reads from spriteContents at call time, so updateTemplates() after
 * a watcher rebuild automatically refreshes the injected SVG content.
 */
export function setupAutoInject(
  injectCollections: SpriteCollection[],
  spriteContents: Map<string, string>,
): string {
  const filename = 'nuxt-svgo-sprite/inject.nitro.ts'

  const tpl = addTemplate({
    filename,
    getContents: () => {
      const sprites = injectCollections
        .map(col => spriteContents.get(col.name) ?? '')
        .filter(Boolean)
        .join('\n')

      return `import { defineNitroPlugin } from 'nitropack/runtime'

const SPRITES = ${JSON.stringify(sprites)}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html) => {
    html.bodyPrepend.push(SPRITES)
  })
})
`
    },
    write: true,
  })

  addServerPlugin(tpl.dst)

  return filename
}
