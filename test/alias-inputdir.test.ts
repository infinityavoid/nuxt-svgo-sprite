import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('nuxt-svgo-sprite ~ alias inputDir', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/alias-inputdir', import.meta.url)),
  })

  it('resolves inputDir with ~ alias and inlines sprite symbols', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="check"')
    expect(html).toContain('id="star"')
  })
})
