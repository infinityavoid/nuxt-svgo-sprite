import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { cleanupDevServerProcessTree } from './utils/dev-server-cleanup'

// Real production-build verification: a MISSING `inputDir` and an existing-but-
// EMPTY `inputDir` both register `SvgUse`, every `*Sprite` component, and
// `icon-names.d.ts`/`AllIconName` (with an empty icon set) via the same code path —
// the missing case is the one a fresh install actually hits first (this module's
// own README quick-start creates icons only after installing).
//
// This fixture deliberately has NO `assets/icons/` directory at all — git can't
// track an empty directory, so "missing" is the fixture's natural committed state;
// no setup/teardown needed to create the missing-ness.
//
// dev: true (not production) specifically so `.nuxt/nuxt-svgo-sprite/icon-names.d.ts`
// is reliably readable from disk — @nuxt/test-utils' production mode nests buildDir
// under a randomized, short-lived `.nuxt/test/<id>/` path (see tree-shaking.test.ts's
// own comment on this), which this test's second assertion needs to avoid.
describe('nuxt-svgo-sprite registers SvgUse/types even when inputDir does not exist yet', async () => {
  const fixtureDir = fileURLToPath(new URL('./fixtures/missing-input-dir', import.meta.url))

  await setup({ rootDir: fixtureDir, dev: true })
  cleanupDevServerProcessTree()

  it('SvgUse resolves and renders (not a Vue "unresolved component" fallthrough)', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('href="#not-yet"')
    // A truly unresolved Vue component renders its tag name lowercased/kebab-cased
    // verbatim into the DOM instead of expanding to a real element — this must NOT
    // appear if SvgUse actually resolved as a component.
    expect(html.toLowerCase()).not.toContain('<svguse')
  })

  it('icon-names.d.ts is still generated, with an empty AllIconName', async () => {
    const content = await fsp.readFile(
      path.join(fixtureDir, '.nuxt', 'nuxt-svgo-sprite', 'icon-names.d.ts'),
      'utf-8',
    )
    expect(content).toContain('AllIconName = never')
  })
})
