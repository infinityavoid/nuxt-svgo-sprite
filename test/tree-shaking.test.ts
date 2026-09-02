import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

// Real production-build verification for tree-shaking. Fixture has
// 4 icons: "home" (referenced via <SvgUse name="home">), "star" (referenced via the
// generated <UseStar /> component tag), "unused" (never referenced anywhere),
// "dynamic-only" (never referenced literally either — kept only via
// treeShakingInclude, simulating an icon whose name is computed at runtime, which a
// literal-string scan can never see by construction).
//
// The complementary claim — that tree-shaking narrows ONLY the sprite payload, never
// the generated types/Use* components (DevTools/autocomplete/type-checking stay
// identical to a non-tree-shaken build) — is covered at the unit level
// (sprite-builder.test.ts's "isUsed" suite: onIconResult still fires included=true
// for an excluded icon, which is what feeds effectiveCollections/types/component
// generation) and was additionally verified directly against a real `nuxi build`
// CLI run on this exact fixture: `.nuxt/nuxt-svgo-sprite/use-components.ts` still
// exported `UseUnused`, and `icon-names.d.ts` still listed `"unused"`, even though
// the SSR HTML below never contains `id="unused"`. Not encoded as a standing e2e
// test here — kept as a unit-level guarantee (sprite-builder.test.ts) instead.
describe('nuxt-svgo-sprite tree-shaking — production build', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/tree-shaking', import.meta.url)),
    // Keeps this suite's build output out of `.nuxt` entirely (`.build-*` is
    // gitignored) — cheap insurance against `nuxi dev`'s own startup-time
    // clearBuildDir (test/tree-shaking-dev.test.ts runs concurrently against the
    // same fixture; unrelated to and much rarer than the teardown race this
    // fixture split was originally, mistakenly, built to avoid).
    buildDir: fileURLToPath(new URL('./fixtures/tree-shaking/.build-prod', import.meta.url)),
  })

  it('keeps an icon referenced via <SvgUse name="...">', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="home"')
  })

  it('keeps an icon referenced via its generated <Use*/> component tag', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="star"')
  })

  it('drops an icon never referenced anywhere in source', async () => {
    const html = await $fetch<string>('/')
    expect(html).not.toContain('id="unused"')
  })

  it('keeps an icon force-included via treeShakingInclude despite no literal reference — the escape hatch for dynamic usages the scan cannot see', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="dynamic-only"')
  })

  it('keeps an icon referenced only by its kebab-case auto-import tag (<use-kebab-only />)', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="kebab-only"')
  })
})
