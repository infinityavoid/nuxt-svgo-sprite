import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('nuxt-svgo-sprite nuxt.options.ignore', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/ignore', import.meta.url)),
  })

  it('includes an icon not covered by nuxt.options.ignore', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="home"')
  })

  it('excludes an entire folder matched by nuxt.options.ignore at cold build — not just at the dev watcher level', async () => {
    // Before this, only the dev watcher (chokidar) honored nuxt.options.ignore — the
    // cold-build walker didn't, so an ignored folder's icon still ended up in the
    // sprite on first build (only failing to hot-reload afterward, silently).
    const html = await $fetch<string>('/')
    expect(html).not.toContain('id="draft-hidden"')
    expect(html).not.toContain('<rect')
  })
})
