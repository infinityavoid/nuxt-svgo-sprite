import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { cleanupDevServerProcessTree } from './utils/dev-server-cleanup'

// Real dev-server verification: under a non-root app.baseURL, the DevTools
// middleware must actually be reachable at the joined path
// (baseURL + '/__nuxt-svgo-sprite'), not the bare, unjoined default. Unit tests
// (devtools.test.ts) already cover the joining logic and the tab-src/middleware-path
// agreement in isolation; this confirms it against a real running dev server.
describe('nuxt-svgo-sprite DevTools under a non-root app.baseURL', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/devtools-baseurl', import.meta.url)),
    dev: true,
  })
  cleanupDevServerProcessTree()

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
