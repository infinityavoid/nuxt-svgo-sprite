import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('nuxt-svgo-sprite inputDir outside srcDir', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/outside-srcdir', import.meta.url)),
  })

  it('cold-builds correctly when inputDir (~~/icons) resolves outside srcDir (./app)', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="home"')
    expect(html).toContain('href="#home"')
  })
})
