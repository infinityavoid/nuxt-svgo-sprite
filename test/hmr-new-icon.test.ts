import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

// Real dev-server regression test for backlog items #5 and #16:
//   - #5: a NEW icon added while the dev server is running must get its <Use*/>
//     component actually registered with Nuxt (not just its sprite/type templates
//     updated) — and the fix that makes this self-contained (rebuild.ts's own
//     filterless updateTemplates()) must coexist safely with watcher.ts no longer
//     awaiting the debounced rebuild handler.
//   - #16 (ADR-025, closes ADR-011): a DELETED icon's <Use*/> component must
//     actually stop being registered too — no dev-server restart required. This is
//     the addComponentExports-based rewrite of the Use* components file: unlike the
//     old addComponent-per-icon approach (kit has no removeComponent API), rewriting
//     the shared file to drop an export and calling updateTemplates() with no filter
//     genuinely un-resolves it.
// A mock could not catch a regression in either: the whole bug class is about real
// Nuxt hook-ordering and its internal "app structure version" cache, neither of
// which exists in a mock.
//
// Checked via .nuxt/components.d.ts — the real, on-disk artifact Nuxt's own
// components module writes from its resolved component list — rather than via a
// custom hook: hooking components:extend/app:templates directly turned out to be
// unreliable to observe correctly from a second, independently-registered module
// (registration-order relative to nuxt-svgo-sprite's OWN addComponent-registered
// listener made a same-session capture racy), where the generated file is not.

const fixtureDir = fileURLToPath(new URL('./fixtures/hmr-new-icon', import.meta.url))
const newIconPath = path.join(fixtureDir, 'assets', 'icons', 'star.svg')
const componentsDeclarationPath = path.join(fixtureDir, '.nuxt', 'components.d.ts')

async function declaresComponent(name: string): Promise<boolean> {
  try {
    const content = await fsp.readFile(componentsDeclarationPath, 'utf-8')
    return content.includes(`export const ${name}:`)
  }
  catch {
    return false
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

describe('nuxt-svgo-sprite HMR: new icon registers a real component (item #5)', async () => {
  afterAll(async () => {
    await fsp.rm(newIconPath, { force: true })
  })

  await setup({ rootDir: fixtureDir, dev: true })

  it('registers UseCheck at cold start', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="check"')
    expect(await declaresComponent('UseCheck')).toBe(true)
  })

  it('registers a real UseStar component after adding star.svg while the dev server is running', async () => {
    await fsp.writeFile(newIconPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>\n', 'utf-8')

    const gotNew = await waitUntil(() => declaresComponent('UseStar'), 15_000)
    expect(gotNew).toBe(true)
  }, 20_000)

  it('unregisters UseStar after deleting star.svg while the dev server is running — no restart needed (item #16, closes ADR-011)', async () => {
    // Depends on the previous test having added star.svg (and UseStar being
    // currently registered) — proves the REMOVE direction of the same mechanism.
    await fsp.rm(newIconPath, { force: true })

    const gotRemoved = await waitUntil(async () => !(await declaresComponent('UseStar')), 15_000)
    expect(gotRemoved).toBe(true)
    // UseCheck (never touched) must still be there — proves this wasn't a full,
    // destructive re-scan that happened to drop everything.
    expect(await declaresComponent('UseCheck')).toBe(true)
  }, 20_000)
})
