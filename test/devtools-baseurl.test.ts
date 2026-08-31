import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

// Real dev-server verification for backlog item #17: under a non-root app.baseURL,
// the DevTools middleware must actually be reachable at the joined path
// (baseURL + '/__nuxt-svgo-sprite'), not the bare, unjoined default. Unit tests
// (devtools.test.ts) already cover the joining logic and the tab-src/middleware-path
// agreement in isolation; this confirms it against a real running dev server, which
// is what the backlog item explicitly asked for before treating #17 as settled.
describe('nuxt-svgo-sprite DevTools under a non-root app.baseURL (item #17)', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/devtools-baseurl', import.meta.url)),
    dev: true,
  })

  it('serves the app itself under the configured baseURL', async () => {
    const html = await $fetch<string>('/my-app/')
    expect(html).toContain('id="home"')
  })

  it('serves the DevTools client shell at baseURL + /__nuxt-svgo-sprite', async () => {
    const html = await $fetch<string>('/my-app/__nuxt-svgo-sprite')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('SVG Sprite')
  })

  it('embeds the joined routePath into the client shell, so preview-image URLs resolve under baseURL too', async () => {
    const html = await $fetch<string>('/my-app/__nuxt-svgo-sprite')
    expect(html).toContain('"/my-app/__nuxt-svgo-sprite"')
  })
}, 30_000)
