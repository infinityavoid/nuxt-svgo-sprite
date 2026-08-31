import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('nuxt-svgo-sprite Nuxt layers', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/layers', import.meta.url)),
  })

  it('resolves inputDir with ~ alias in a layered app and inlines sprite symbols', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="home"')
  })

  it('renders SvgUse href link for the icon', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('href="#home"')
  })

  it('merges a layer-provided icon into the app\'s default collection', async () => {
    // base-layer/assets/icons/check.svg has no name collision with the app's own
    // icons — it should simply appear alongside "home" in the default sprite.
    const html = await $fetch<string>('/')
    expect(html).toContain('id="check"')
  })

  it('creates a new named collection purely from a layer-provided subfolder', async () => {
    // base-layer/assets/icons/brand/logo.svg — the app itself has no "brand" folder.
    const html = await $fetch<string>('/')
    expect(html).toContain('id="brand-logo"')
    expect(html).toContain('href="#brand-logo"')
  })

  it('the app\'s own icon wins a symbol-id collision with a layer-provided icon', async () => {
    // Both the app (assets/icons/close.svg, a <circle>) and base-layer
    // (assets/icons/close.svg, a <rect>) ship a "close" icon. The app is the
    // highest-priority root, so its shape must be the one that survives — and only
    // once, not merged/duplicated.
    const html = await $fetch<string>('/')
    const closeSymbolMatches = html.match(/id="close"/g) ?? []
    expect(closeSymbolMatches).toHaveLength(1)
    expect(html).toMatch(/<symbol[^>]* id="close"[^>]*>\s*<circle/)
    expect(html).not.toContain('<rect')
  })
})
