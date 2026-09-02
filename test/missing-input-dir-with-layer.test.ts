import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { cleanupDevServerProcessTree } from './utils/dev-server-cleanup'

// Real dev-server regression test, complementing missing-input-dir.test.ts: when the
// app's own `inputDir` doesn't exist yet but a Nuxt layer DOES ship icons,
// collections build fine from the layer alone (resolveLayerInputDirs'
// `appRootExists` parameter). This fixture deliberately has NO `assets/icons/` of
// its own — git can't track an empty directory, so "missing" is its natural
// committed state — while its one extended layer ships an icon.
//
// `setupWatcher` must be handed a root list that always includes the app's own
// not-yet-created inputDir (not just the existence-filtered list used for the cold
// build), so a real, actively-running watcher can still warn when that folder
// appears later, mid dev-session. That is `resolveWatcherRoots` (utils/layers.ts),
// covered directly by dedicated unit tests there (proves the app root is always
// included) plus the existing `setupWatcher`/multi-root unit tests in
// watcher.test.ts (proves a listed-but-collection-less root still gets the "outside
// known collections — restart" warning). Not re-verified here via a live dev-server
// log assertion: this harness's `getServerLogs()` does not reliably capture this
// module's own consola output in dev mode (confirmed empirically — even the
// unconditional cold-build "Sprite built" info line never showed up). A warning-only
// side effect has no on-disk artifact to check, so the unit coverage above is this
// behavior's actual regression lock.
describe('nuxt-svgo-sprite: missing app inputDir + a layer with icons', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/missing-input-dir-with-layer', import.meta.url)),
    dev: true,
  })
  cleanupDevServerProcessTree()

  it('the layer\'s icon still works even though the app has no inputDir of its own', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="check"')
  })
})
