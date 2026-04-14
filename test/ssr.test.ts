import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('nuxt-svgo-sprite SSR', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  })

  it('inlines sprite symbols into SSR HTML', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('id="check"')
    expect(html).toContain('id="star"')
  })

  it('renders SvgUse href links for icons', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('href="#check"')
    expect(html).toContain('href="#star"')
  })
})
