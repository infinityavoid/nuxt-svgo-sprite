import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { cleanupDevServerProcessTree } from './utils/dev-server-cleanup'

// Real dev-server regression test: a collection merged from an app root and a
// Nuxt layer root must be rebuilt from EVERY contributing source, not just the
// highest-priority one — rebuilding from a single source would silently drop
// every OTHER source's icons from the sprite, unregister their <Use*/>
// components, and remove their ids from the generated type on any HMR rebuild
// of that collection, even one triggered by an edit that never touched the
// dropped source at all.
//
// A mock could not catch this: the whole bug class is about which real
// directories get re-read on a real filesystem-triggered rebuild. Checked via
// the real, on-disk `.nuxt/components.d.ts` and
// `.nuxt/nuxt-svgo-sprite/icon-names.d.ts` artifacts, same pattern as
// hmr-new-icon.test.ts.

const fixtureDir = fileURLToPath(new URL('./fixtures/layers-hmr', import.meta.url))
const appIconPath = path.join(fixtureDir, 'assets', 'icons', 'star.svg')
const layerIconPath = path.join(fixtureDir, 'base-layer', 'assets', 'icons', 'bell.svg')
const componentsDeclarationPath = path.join(fixtureDir, '.nuxt', 'components.d.ts')
const iconNamesDeclarationPath = path.join(fixtureDir, '.nuxt', 'nuxt-svgo-sprite', 'icon-names.d.ts')

async function declaresComponent(name: string): Promise<boolean> {
  try {
    const content = await fsp.readFile(componentsDeclarationPath, 'utf-8')
    return content.includes(`export const ${name}:`)
  }
  catch {
    return false
  }
}

async function declaresIconId(id: string): Promise<boolean> {
  try {
    const content = await fsp.readFile(iconNamesDeclarationPath, 'utf-8')
    return content.includes(`"${id}"`)
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

describe('nuxt-svgo-sprite HMR across a layer-merged collection', async () => {
  afterAll(async () => {
    await fsp.rm(appIconPath, { force: true })
    await fsp.rm(layerIconPath, { force: true })
  })

  await setup({ rootDir: fixtureDir, dev: true })
  cleanupDevServerProcessTree()

  it('registers both the app\'s and the layer\'s icon at cold start', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="home"')
    expect(html).toContain('id="check"')
    expect(await declaresComponent('UseHome')).toBe(true)
    expect(await declaresComponent('UseCheck')).toBe(true)
    expect(await declaresIconId('check')).toBe(true)
  })

  it('THE REGRESSION: adding an icon in the APP\'s own folder does not drop the layer\'s icon', async () => {
    await fsp.writeFile(appIconPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>\n', 'utf-8')

    const gotNew = await waitUntil(() => declaresComponent('UseStar'), 15_000)
    expect(gotNew).toBe(true)

    // The whole point: the layer's icon must SURVIVE this rebuild, which never
    // touched the layer at all.
    expect(await declaresComponent('UseCheck')).toBe(true)
    expect(await declaresIconId('check')).toBe(true)
  }, 20_000)

  it('adding an icon in the LAYER\'s own folder is picked up too — lifts the old restart-only limitation', async () => {
    await fsp.writeFile(layerIconPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>\n', 'utf-8')

    const gotNew = await waitUntil(() => declaresComponent('UseBell'), 15_000)
    expect(gotNew).toBe(true)
    expect(await declaresComponent('UseHome')).toBe(true)
    expect(await declaresComponent('UseCheck')).toBe(true)
  }, 20_000)
})
