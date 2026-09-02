import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isOutsideSrcDir, resolveLayerInputDirs, resolveScanRoots, resolveWatcherRoots } from '../../src/utils/layers'
import type { Nuxt } from '@nuxt/schema'

function makeFakeNuxt(rootDir: string, srcDir: string, layerDirs: string[] = []): Nuxt {
  const layers = [rootDir, ...layerDirs].map(dir => ({
    cwd: dir,
    config: { rootDir: dir, srcDir: dir === rootDir ? srcDir : dir },
  }))
  return {
    options: {
      rootDir,
      srcDir,
      alias: {},
      _layers: layers,
      // Mirrors @nuxt/schema's own resolution: serverDir always resolves against
      // rootDir, independent of srcDir — getLayerDirectories substitutes the full
      // (already-schema-resolved) nuxt.options as `config` for the app's own layer,
      // so this must be set here for resolveScanRoots' tests to reflect real Nuxt
      // behavior rather than the OTHER (unresolved-relative) branch getLayerDirectories
      // takes for a plain extended layer.
      serverDir: path.join(rootDir, 'server'),
    },
  } as unknown as Nuxt
}

// ── isOutsideSrcDir ──────────────────────────────────────────────────────────────

describe('isOutsideSrcDir', () => {
  it('returns false for a dir inside srcDir', () => {
    const nuxt = makeFakeNuxt('/app', '/app')
    expect(isOutsideSrcDir(nuxt, '/app/assets/icons')).toBe(false)
  })

  it('returns false for srcDir itself', () => {
    const nuxt = makeFakeNuxt('/app', '/app')
    expect(isOutsideSrcDir(nuxt, '/app')).toBe(false)
  })

  it('returns true for a dir outside srcDir (e.g. inputDir: "~~/icons")', () => {
    const nuxt = makeFakeNuxt('/app', '/app/app')
    expect(isOutsideSrcDir(nuxt, '/app/icons')).toBe(true)
  })

  it('returns false for a dir under a custom srcDir', () => {
    const nuxt = makeFakeNuxt('/app', '/app/app')
    expect(isOutsideSrcDir(nuxt, '/app/app/assets/icons')).toBe(false)
  })
})

// ── resolveLayerInputDirs ─────────────────────────────────────────────────────────

describe('resolveLayerInputDirs', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'svgo-sprite-layers-test-'))
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns a single (root) entry when inputDir resolves outside srcDir', async () => {
    const nuxt = makeFakeNuxt(tmpDir, path.join(tmpDir, 'app'))
    const iconDir = path.join(tmpDir, 'icons') // outside srcDir (tmpDir/app)
    const roots = await resolveLayerInputDirs(nuxt, iconDir)
    expect(roots).toEqual([{ dir: iconDir, label: '(root)' }])
  })

  it('returns just the app root when there are no other layers', async () => {
    const nuxt = makeFakeNuxt(tmpDir, tmpDir)
    const iconDir = path.join(tmpDir, 'assets', 'icons')
    const roots = await resolveLayerInputDirs(nuxt, iconDir)
    expect(roots).toEqual([{ dir: iconDir, label: '(root)' }])
  })

  it('includes a layer whose mirrored icon folder exists, labeled with the layer dirname', async () => {
    const layerDir = path.join(tmpDir, 'base-layer')
    await fsp.mkdir(path.join(layerDir, 'assets', 'icons'), { recursive: true })

    const nuxt = makeFakeNuxt(tmpDir, tmpDir, [layerDir])
    const iconDir = path.join(tmpDir, 'assets', 'icons')
    const roots = await resolveLayerInputDirs(nuxt, iconDir)

    expect(roots).toHaveLength(2)
    expect(roots[0]).toEqual({ dir: iconDir, label: '(root)' })
    expect(roots[1]).toEqual({
      dir: path.join(layerDir, 'assets', 'icons'),
      label: 'layer "base-layer"',
    })
  })

  it('omits a layer whose mirrored icon folder does not exist — most layers have no icons', async () => {
    const layerDir = path.join(tmpDir, 'base-layer')
    await fsp.mkdir(layerDir, { recursive: true }) // layer exists, but no assets/icons in it

    const nuxt = makeFakeNuxt(tmpDir, tmpDir, [layerDir])
    const iconDir = path.join(tmpDir, 'assets', 'icons')
    const roots = await resolveLayerInputDirs(nuxt, iconDir)

    expect(roots).toEqual([{ dir: iconDir, label: '(root)' }])
  })

  // ── appRootExists ───────────────────────────────────────────────────────────

  it('appRootExists: false excludes the app root but still includes a layer whose mirrored folder exists', async () => {
    const layerDir = path.join(tmpDir, 'base-layer')
    await fsp.mkdir(path.join(layerDir, 'assets', 'icons'), { recursive: true })

    const nuxt = makeFakeNuxt(tmpDir, tmpDir, [layerDir])
    const iconDir = path.join(tmpDir, 'assets', 'icons') // does NOT exist on disk
    const roots = await resolveLayerInputDirs(nuxt, iconDir, false)

    expect(roots).toEqual([{ dir: path.join(layerDir, 'assets', 'icons'), label: 'layer "base-layer"' }])
  })

  it('appRootExists: false, outside-srcDir branch returns [] instead of a root pointing at a nonexistent directory', async () => {
    const nuxt = makeFakeNuxt(tmpDir, path.join(tmpDir, 'app'))
    const iconDir = path.join(tmpDir, 'icons') // outside srcDir (tmpDir/app)
    const roots = await resolveLayerInputDirs(nuxt, iconDir, false)
    expect(roots).toEqual([])
  })

  it('appRootExists defaults to true — existing two-argument call sites are unaffected', async () => {
    const nuxt = makeFakeNuxt(tmpDir, tmpDir)
    const iconDir = path.join(tmpDir, 'assets', 'icons')
    const roots = await resolveLayerInputDirs(nuxt, iconDir)
    expect(roots).toEqual([{ dir: iconDir, label: '(root)' }])
  })
})

// ── resolveScanRoots ────────────────────────────────────────────────────────────

describe('resolveScanRoots', () => {
  it('Nuxt-4-style layout (srcDir = rootDir/app): app, shared, and server are all siblings, all kept', () => {
    const rootDir = path.join(path.sep, 'proj')
    const srcDir = path.join(rootDir, 'app')
    const nuxt = makeFakeNuxt(rootDir, srcDir)

    const roots = resolveScanRoots(nuxt)

    expect(roots).toContain(path.normalize(srcDir))
    expect(roots).toContain(path.normalize(path.join(rootDir, 'shared')))
    expect(roots).toContain(path.normalize(path.join(rootDir, 'server')))
    expect(roots).toHaveLength(3)
  })

  it('Nuxt-3-style layout (srcDir === rootDir): shared/server are nested under app and dropped', () => {
    const rootDir = path.join(path.sep, 'proj')
    const nuxt = makeFakeNuxt(rootDir, rootDir)

    const roots = resolveScanRoots(nuxt)

    expect(roots).toEqual([path.normalize(rootDir)])
  })

  it('includes an extra layer\'s own app dir; its nested shared/server are dropped', () => {
    const rootDir = path.join(path.sep, 'proj')
    const srcDir = path.join(rootDir, 'app')
    const layerDir = path.join(path.sep, 'layer')
    const nuxt = makeFakeNuxt(rootDir, srcDir, [layerDir])

    const roots = resolveScanRoots(nuxt)

    expect(roots).toContain(path.normalize(srcDir))
    expect(roots).toContain(path.normalize(path.join(rootDir, 'shared')))
    expect(roots).toContain(path.normalize(path.join(rootDir, 'server')))
    // The layer is a flat (Nuxt-3-style) layout in makeFakeNuxt: layer's own
    // shared/server nest under its own root and are dropped, same as the app case.
    expect(roots).toContain(path.normalize(layerDir))
    expect(roots).toHaveLength(4)
  })

  it('returns no trailing slashes, regardless of getLayerDirectories\' own trailing-slash convention', () => {
    const rootDir = path.join(path.sep, 'proj')
    const srcDir = path.join(rootDir, 'app')
    const nuxt = makeFakeNuxt(rootDir, srcDir)

    const roots = resolveScanRoots(nuxt)

    for (const root of roots) {
      expect(root.endsWith('/')).toBe(false)
      expect(root.endsWith('\\')).toBe(false)
    }
  })

  it('dedupes an identical layer dir listed twice', () => {
    const rootDir = path.join(path.sep, 'proj')
    const srcDir = path.join(rootDir, 'app')
    const layerDir = path.join(path.sep, 'layer')
    const nuxt = makeFakeNuxt(rootDir, srcDir, [layerDir, layerDir])

    const roots = resolveScanRoots(nuxt)

    expect(roots.filter(r => r === path.normalize(layerDir))).toHaveLength(1)
  })
})

// ── resolveWatcherRoots ──────────────────────────────────────────────────────

describe('resolveWatcherRoots', () => {
  const iconDir = path.join(path.sep, 'proj', 'app', 'assets', 'icons')
  const layerRoots = [{ dir: path.join(path.sep, 'layer', 'assets', 'icons'), label: 'layer "base-layer"' }]

  it('when iconDirExists is true, returns layerRoots unchanged (app root is already its [0])', () => {
    const appFirst = [{ dir: iconDir, label: '(root)' }, ...layerRoots]
    expect(resolveWatcherRoots(iconDir, true, appFirst)).toBe(appFirst)
  })

  it('when iconDirExists is false, prepends the app root even though it is absent from layerRoots', () => {
    // layerRoots here does NOT include the app root — exactly what
    // resolveLayerInputDirs(nuxt, iconDir, false) produces when a layer ships
    // icons but the app's own inputDir doesn't exist yet.
    const result = resolveWatcherRoots(iconDir, false, layerRoots)
    expect(result).toEqual([{ dir: iconDir, label: '(root)' }, ...layerRoots])
  })

  it('when iconDirExists is false and there are no layer roots either, still returns the app root alone', () => {
    const result = resolveWatcherRoots(iconDir, false, [])
    expect(result).toEqual([{ dir: iconDir, label: '(root)' }])
  })
})
