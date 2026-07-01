import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('autoInjectSprite: [\'admin\']', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/auto-inject-selective', import.meta.url)),
  })

  it('injects only the listed collection', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="admin-star"')
  })

  it('does not inject unlisted collections', async () => {
    const html = await $fetch<string>('/')
    expect(html).not.toContain('id="home"')
  })
})
