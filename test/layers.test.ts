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
})
