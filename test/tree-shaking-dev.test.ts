import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

// Real dev-server verification that tree-shaking (item #6) NEVER applies to
// `nuxt dev`, even with `treeShaking: true` configured — the owner's own explicit
// call (an icon "disappearing" mid-development because the literal-string scan
// missed a usage is far harder to notice/debug than the same thing happening in a
// build about to ship). Uses the SAME fixture/config as tree-shaking.test.ts
// (production mode) — only the `dev: true` flag differs.
describe('nuxt-svgo-sprite tree-shaking never applies in dev mode (item #6)', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/tree-shaking', import.meta.url)),
    dev: true,
  })

  it('keeps an icon that would be tree-shaken out in production ("unused", never referenced anywhere)', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="home"')
    expect(html).toContain('id="unused"')
  })
})
