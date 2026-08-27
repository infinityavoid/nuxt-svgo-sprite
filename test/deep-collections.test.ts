import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('nuxt-svgo-sprite deep collections', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/deep-collections', import.meta.url)),
  })

  it('two-level nested folder produces correct symbol id', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="admin-buttons-close"')
  })

  it('raw icon preserves its SVG comment in the sprite', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('raw-preserved')
  })

  it('renders SvgUse href links for both icons', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('href="#home"')
    expect(html).toContain('href="#admin-buttons-close"')
  })
})
