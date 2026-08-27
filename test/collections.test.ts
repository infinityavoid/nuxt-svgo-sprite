import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('nuxt-svgo-sprite multi-collection', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/collections', import.meta.url)),
  })

  it('inlines default collection symbols into SSR HTML', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="home"')
  })

  it('inlines named collection symbols into SSR HTML', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="admin-star"')
  })

  it('renders SvgUse href links for default collection icons', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('href="#home"')
  })

  it('renders SvgUse href links for named collection icons', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('href="#admin-star"')
  })

  it('both sprites carry aria-hidden', async () => {
    const html = await $fetch<string>('/')
    const matches = [...html.matchAll(/aria-hidden="true"/g)]
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})
