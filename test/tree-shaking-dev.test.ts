import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { cleanupDevServerProcessTree } from './utils/dev-server-cleanup'

// Real dev-server verification that tree-shaking never applies to `nuxt dev`, even
// with `treeShaking: true` configured — an icon "disappearing" mid-development
// because the literal-string scan missed a usage is far harder to notice/debug than
// the same thing happening in a build about to ship.
//
// Shares fixtures/tree-shaking with tree-shaking.test.ts (production mode),
// differing only by `dev: true`. This module always creates its buildDir
// synchronously during setup() (createUseComponents writes a file there before
// @nuxt/test-utils checks whether the dir already existed), so @nuxt/test-utils'
// own buildDir-teardown never actually registers for either suite here — verified
// directly by reading its source and by running both suites against this shared
// fixture repeatedly with no corruption. tree-shaking.test.ts additionally sets an
// explicit `buildDir` outside `.nuxt` as cheap insurance against a much rarer,
// unrelated hazard: `nuxi dev`'s own startup-time `clearBuildDir` (triggered by a
// stale `.nuxt/nuxt.json` from a different Nuxt version, not by this pairing).
describe('nuxt-svgo-sprite tree-shaking never applies in dev mode', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/tree-shaking', import.meta.url)),
    dev: true,
  })
  cleanupDevServerProcessTree()

  it('keeps an icon that would be tree-shaken out in production ("unused", never referenced anywhere)', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="home"')
    expect(html).toContain('id="unused"')
  })
})
