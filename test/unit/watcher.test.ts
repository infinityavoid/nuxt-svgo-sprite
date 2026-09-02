import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findOwningCollection, handleWatchEvent, setupWatcher } from '../../src/watcher/watcher'
import type { SpriteCollection, CollectionSource } from '../../src/types/types'
import type { Nuxt } from '@nuxt/schema'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCollection(
  name: string,
  inputDir: string,
  segments: string[] = [],
  icons: SpriteCollection['icons'] = [],
  sources?: CollectionSource[],
): SpriteCollection {
  return {
    name,
    segments,
    inputDir,
    sources: sources ?? [{ dir: inputDir, label: '(root)' }],
    spriteComponentName: name === 'default' ? 'DefaultSprite' : `${name.charAt(0).toUpperCase() + name.slice(1)}Sprite`,
    typeName: `${name.charAt(0).toUpperCase() + name.slice(1)}IconName`,
    icons,
  }
}

const iconRoot = path.join(os.tmpdir(), 'watcher-test-icons')
const iconRootAsRoots: CollectionSource[] = [{ dir: iconRoot, label: '(root)' }]
const sep = path.sep

const defaultCol = makeCollection('default', iconRoot, [])
const adminCol = makeCollection('admin', path.join(iconRoot, 'admin'), ['admin'])
const adminButtonsCol = makeCollection(
  'adminButtons',
  path.join(iconRoot, 'admin', 'buttons'),
  ['admin', 'buttons'],
)

const collections = [defaultCol, adminCol, adminButtonsCol]

const mockLogger = { info: vi.fn(), warn: vi.fn() }
beforeEach(() => vi.clearAllMocks())

// ── findOwningCollection ───────────────────────────────────────────────────────

describe('findOwningCollection', () => {
  it('routes root-level file to default collection', () => {
    const result = findOwningCollection(path.join(iconRoot, 'home.svg'), collections)
    expect(result?.name).toBe('default')
  })

  it('routes file in named subfolder to that collection', () => {
    const result = findOwningCollection(path.join(iconRoot, 'admin', 'star.svg'), collections)
    expect(result?.name).toBe('admin')
  })

  it('routes deeply nested file to the most specific collection', () => {
    const result = findOwningCollection(
      path.join(iconRoot, 'admin', 'buttons', 'close.svg'),
      collections,
    )
    expect(result?.name).toBe('adminButtons')
  })

  it('routes file in default/ subfolder to default collection', () => {
    const result = findOwningCollection(
      path.join(iconRoot, 'default', 'extra.svg'),
      collections,
    )
    expect(result?.name).toBe('default')
  })

  it('returns undefined for file outside all known collection folders', () => {
    const result = findOwningCollection('/totally/different/icon.svg', collections)
    expect(result).toBeUndefined()
  })

  it('does not confuse a path that is a string prefix of inputDir', () => {
    // iconRoot + '-extra' should NOT match iconRoot
    const result = findOwningCollection(iconRoot + '-extra' + sep + 'icon.svg', collections)
    expect(result).toBeUndefined()
  })

  it('returns undefined when collections array is empty', () => {
    const result = findOwningCollection(path.join(iconRoot, 'home.svg'), [])
    expect(result).toBeUndefined()
  })

  it('returns undefined for a file in a brand new subfolder, instead of misrouting it to default', () => {
    // Regression: a prefix-based match would route this to `default` (whose inputDir
    // is the tree root) since iconRoot is a string-prefix of every path under it.
    const result = findOwningCollection(path.join(iconRoot, 'social', 'twitter.svg'), collections)
    expect(result).toBeUndefined()
  })
})

// ── handleWatchEvent ──────────────────────────────────────────────────────────

describe('handleWatchEvent', () => {
  it('always calls onCollectionChange', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined)
    await handleWatchEvent('change', '/icons/admin/star.svg', adminCol, mockLogger, onChange)
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(adminCol, 'change', '/icons/admin/star.svg')
  })

  it('never logs a warning itself on unlink — the component is actually unregistered instead, not just flagged for a restart', async () => {
    const col = makeCollection('admin', '/icons/admin', ['admin'], [
      { id: 'admin-star', componentName: 'UseAdminStar', absolutePath: '/icons/admin/star.svg' },
    ])
    const onChange = vi.fn().mockResolvedValue(undefined)
    await handleWatchEvent('unlink', '/icons/admin/star.svg', col, mockLogger, onChange)

    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(col, 'unlink', '/icons/admin/star.svg')
  })
})

// ── setupWatcher ──────────────────────────────────────────────────────────────

describe('setupWatcher', () => {
  type MockNuxt = Nuxt & { triggerWatch: (event: string, relativePath: string) => Promise<void> }

  function makeMockNuxt(rootDir: string, srcDir: string = rootDir): MockNuxt {
    const hookHandlers: Record<string, (event: string, relativePath: string) => Promise<void>> = {}
    return {
      options: { rootDir, srcDir },
      hook: vi.fn((name: string, handler: (event: string, relativePath: string) => Promise<void>) => {
        hookHandlers[name] = handler
      }),
      triggerWatch: async (event: string, relativePath: string) => {
        await hookHandlers['builder:watch']?.(event, relativePath)
      },
    } as unknown as MockNuxt
  }

  it('routes change event in known collection to onCollectionChange', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, iconRootAsRoots, mockLogger, onChange)

    await nuxt.triggerWatch('change', path.relative(rootDir, path.join(iconRoot, 'home.svg')))
    await new Promise(r => setTimeout(r, 150))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].name).toBe('default')
  })

  it('warns and does not call onCollectionChange for an SVG in a brand new subfolder of inputDir', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, iconRootAsRoots, mockLogger, onChange)

    // A genuinely new collection folder INSIDE inputDir — this is the case the
    // warning exists for.
    const newRel = path.relative(rootDir, path.join(iconRoot, 'social', 'twitter.svg'))
    await nuxt.triggerWatch('add', newRel)
    expect(onChange).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Restart'))
  })

  it('does not warn for an SVG entirely outside inputDir (Nuxt watches all of srcDir, not just our icons folder)', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, iconRootAsRoots, mockLogger, onChange)

    const outsideAbs = path.join(os.tmpdir(), 'completely-outside', 'hero.svg')
    const outsideRel = path.relative(iconRoot, outsideAbs)
    await nuxt.triggerWatch('add', outsideRel)
    expect(onChange).not.toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('resolves relativePath against srcDir, not rootDir, when they differ', async () => {
    // Regression: Nuxt's own first-party consumers (components/imports modules) all
    // resolve builder:watch's relativePath against srcDir, not rootDir — they only
    // ever coincide by default. A deliberately unrelated rootDir here means the OLD
    // rootDir-based resolution would misroute this event entirely (or point at a
    // nonexistent path), while srcDir-based resolution correctly finds "default".
    const srcDir = path.dirname(iconRoot)
    const unrelatedRootDir = path.join(os.tmpdir(), 'unrelated-root-dir-for-srcdir-test')
    const nuxt = makeMockNuxt(unrelatedRootDir, srcDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, iconRootAsRoots, mockLogger, onChange)

    const relToSrcDir = path.relative(srcDir, path.join(iconRoot, 'home.svg'))
    await nuxt.triggerWatch('change', relToSrcDir)
    await new Promise(r => setTimeout(r, 150))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].name).toBe('default')
  })

  it('does not call onCollectionChange for non-SVG files', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, iconRootAsRoots, mockLogger, onChange)

    await nuxt.triggerWatch('change', 'assets/icons/readme.md')
    expect(onChange).not.toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('routes an uppercase .SVG file change the same as a lowercase one', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, iconRootAsRoots, mockLogger, onChange)

    await nuxt.triggerWatch('change', path.relative(rootDir, path.join(iconRoot, 'HOME.SVG')))
    await new Promise(r => setTimeout(r, 150))
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('changes in collection A do not trigger rebuild of collection B', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, iconRootAsRoots, mockLogger, onChange)

    await nuxt.triggerWatch('change', path.relative(rootDir, path.join(iconRoot, 'admin', 'star.svg')))
    await new Promise(r => setTimeout(r, 150))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].name).toBe('admin')
  })

  it('returns a cleanup function that cancels all debounced handlers', () => {
    const nuxt = makeMockNuxt(iconRoot)
    const onChange = vi.fn().mockResolvedValue(undefined)
    const cleanup = setupWatcher(nuxt, { current: collections }, iconRootAsRoots, mockLogger, onChange)
    expect(() => cleanup()).not.toThrow()
  })

  it('reads collectionsRef.current live, not a setup-time snapshot', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    const ref = { current: collections }
    setupWatcher(nuxt, ref, iconRootAsRoots, mockLogger, onChange)

    // Mutate the ref after setup, as a rebuild handler would: admin now has an icon.
    const adminWithIcon = makeCollection('admin', path.join(iconRoot, 'admin'), ['admin'], [
      { id: 'admin-star', componentName: 'UseAdminStar', absolutePath: path.join(iconRoot, 'admin', 'star.svg') },
    ])
    ref.current = ref.current.map(c => (c.name === 'admin' ? adminWithIcon : c))

    await nuxt.triggerWatch('unlink', path.relative(rootDir, path.join(iconRoot, 'admin', 'star.svg')))
    await new Promise(r => setTimeout(r, 150))

    // The setup-time snapshot had no icons for admin — a stale-closure implementation
    // would pass THAT stale, icon-less collection to onChange instead of the current one.
    expect(onChange).toHaveBeenCalledOnce()
    const passedCollection = onChange.mock.calls[0]![0] as SpriteCollection
    expect(passedCollection.icons.map(i => i.id)).toEqual(['admin-star'])
  })
})

// ── findOwningCollection — multi-source ─────────────────────────────────────────

describe('findOwningCollection with a multi-source (layer-merged) collection', () => {
  const layerRoot = path.join(os.tmpdir(), 'watcher-test-layer')
  const multiSourceDefault = makeCollection('default', iconRoot, [], [], [
    { dir: iconRoot, label: '(root)' },
    { dir: layerRoot, label: 'layer "base-layer"' },
  ])
  const multiSourceCollections = [multiSourceDefault]

  it('routes a file in the highest-priority (app) source', () => {
    const result = findOwningCollection(path.join(iconRoot, 'home.svg'), multiSourceCollections)
    expect(result?.name).toBe('default')
  })

  it('routes a file in a LOWER-priority (layer) source too, not just the highest-priority one', () => {
    const result = findOwningCollection(path.join(layerRoot, 'check.svg'), multiSourceCollections)
    expect(result?.name).toBe('default')
  })

  it('routes a file in the layer source\'s own default/ merge folder', () => {
    const result = findOwningCollection(path.join(layerRoot, 'default', 'extra.svg'), multiSourceCollections)
    expect(result?.name).toBe('default')
  })

  it('still returns undefined for a file outside every source', () => {
    const result = findOwningCollection('/totally/different/icon.svg', multiSourceCollections)
    expect(result).toBeUndefined()
  })
})

// ── setupWatcher — multi-root "outside known collections" warning ──────────────

describe('setupWatcher with multiple roots', () => {
  type MockNuxt = Nuxt & { triggerWatch: (event: string, relativePath: string) => Promise<void> }

  function makeMockNuxt(rootDir: string, srcDir: string = rootDir): MockNuxt {
    const hookHandlers: Record<string, (event: string, relativePath: string) => Promise<void>> = {}
    return {
      options: { rootDir, srcDir },
      hook: vi.fn((name: string, handler: (event: string, relativePath: string) => Promise<void>) => {
        hookHandlers[name] = handler
      }),
      triggerWatch: async (event: string, relativePath: string) => {
        await hookHandlers['builder:watch']?.(event, relativePath)
      },
    } as unknown as MockNuxt
  }

  const layerRoot = path.join(os.tmpdir(), 'watcher-test-layer-2')
  const multiRoots: CollectionSource[] = [
    { dir: iconRoot, label: '(root)' },
    { dir: layerRoot, label: 'layer "base-layer"' },
  ]

  it('warns, labeled with the layer\'s name, for a brand new subfolder under a LAYER root', async () => {
    const nuxt = makeMockNuxt(layerRoot)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, multiRoots, mockLogger, onChange)

    const newRel = path.relative(layerRoot, path.join(layerRoot, 'social', 'twitter.svg'))
    await nuxt.triggerWatch('add', newRel)
    expect(onChange).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('layer "base-layer"'))
  })

  it('still warns for a brand new subfolder under the app root, unprefixed', async () => {
    const nuxt = makeMockNuxt(iconRoot)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, multiRoots, mockLogger, onChange)

    const newRel = path.relative(iconRoot, path.join(iconRoot, 'social', 'twitter.svg'))
    await nuxt.triggerWatch('add', newRel)
    expect(onChange).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledOnce()
    expect(mockLogger.warn.mock.calls[0]![0]).not.toContain('layer')
  })

  it('warns for a new subfolder even when a root dir is passed with forward-slash separators (a kit-resolved layer dir on Windows)', async () => {
    // resolveLayerInputDirs' outside-srcDir branch returns iconDir as-is — kit's
    // own resolvePath, forward-slash on Windows — rather than a node-path-built
    // native-separator string. setupWatcher's own path.normalize() on every root
    // (not the test's own layerRoot constant) is what must make this match.
    const forwardSlashRoots: CollectionSource[] = [
      { dir: layerRoot.replace(/\\/g, '/'), label: 'layer "base-layer"' },
    ]
    const nuxt = makeMockNuxt(layerRoot)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, forwardSlashRoots, mockLogger, onChange)

    const newRel = path.relative(layerRoot, path.join(layerRoot, 'social', 'twitter.svg'))
    await nuxt.triggerWatch('add', newRel)
    expect(onChange).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('layer "base-layer"'))
  })
})
