import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isOutsideSrcDir, resolveLayerInputDirs } from '../../src/utils/layers'
import type { Nuxt } from '@nuxt/schema'

function makeFakeNuxt(rootDir: string, srcDir: string, layerDirs: string[] = []): Nuxt {
  const layers = [rootDir, ...layerDirs].map(dir => ({
    cwd: dir,
    config: { rootDir: dir, srcDir: dir === rootDir ? srcDir : dir },
  }))
  return {
    options: { rootDir, srcDir, alias: {}, _layers: layers },
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
})
