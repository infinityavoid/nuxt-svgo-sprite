import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('autoInjectSprite: true', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/auto-inject', import.meta.url)),
  })

  it('inlines default collection symbols without a manual sprite component', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="home"')
  })

  it('inlines named collection symbols without a manual sprite component', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="admin-star"')
  })

  it('SvgUse references resolve correctly', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('href="#home"')
    expect(html).toContain('href="#admin-star"')
  })
})
