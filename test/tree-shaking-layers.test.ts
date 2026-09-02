import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

// Production-build verification: tree-shaking must scan every layer's own
// app/shared/server dir (`resolveScanRoots`, src/utils/layers.ts), not just the
// app's own `nuxt.options.srcDir` — otherwise a Nuxt layer that ships icons AND
// references them only from its own components — or from `shared/`/`server/` — has
// those icons wrongly detected as "unused" and silently dropped from the production
// sprite.
//
// This fixture deliberately uses the Nuxt 4 `app/` layout — with the old flat
// (Nuxt 3-style) layout, srcDir === rootDir already covers a nested layer folder and
// shared/server as children, so this behavior would never be exercised.
describe('nuxt-svgo-sprite tree-shaking scans Nuxt layers, shared/, and server/', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/tree-shaking-layers', import.meta.url)),
  })

  it('keeps an icon referenced only from a layer\'s own component', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="layer-only"')
  })

  it('keeps an icon referenced only from shared/', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="shared-only"')
  })

  it('keeps an icon referenced only from server/', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="server-only"')
  })

  it('keeps an icon referenced from the app itself (control)', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="home"')
  })

  it('still drops an icon referenced nowhere — proves the fix didn\'t just disable shaking', async () => {
    const html = await $fetch<string>('/')
    expect(html).not.toContain('id="ts-unused"')
  })
})
