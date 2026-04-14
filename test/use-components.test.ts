import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('nuxt-svgo-sprite generated wrappers', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/use-components', import.meta.url)),
  })

  it('registers wrapper components for icons', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('href="#check"')
    expect(html).toContain('href="#star"')
  })
})
