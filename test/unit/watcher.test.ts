import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findOwningCollection, handleWatchEvent, setupWatcher } from '../../src/watcher/watcher'
import type { SpriteCollection } from '../../src/types/types'
import type { Nuxt } from '@nuxt/schema'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCollection(
  name: string,
  inputDir: string,
  segments: string[] = [],
  icons: SpriteCollection['icons'] = [],
): SpriteCollection {
  return {
    name,
    segments,
    inputDir,
    spriteComponentName: name === 'default' ? 'DefaultSprite' : `${name.charAt(0).toUpperCase() + name.slice(1)}Sprite`,
    typeName: `${name.charAt(0).toUpperCase() + name.slice(1)}IconName`,
    icons,
  }
}

const iconRoot = path.join(os.tmpdir(), 'watcher-test-icons')
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

  it('logs English unlink warning with icon id and component name', async () => {
    const col = makeCollection('admin', '/icons/admin', ['admin'], [
      { id: 'admin-star', componentName: 'UseAdminStar', absolutePath: '/icons/admin/star.svg' },
    ])
    const onChange = vi.fn().mockResolvedValue(undefined)
    await handleWatchEvent('unlink', '/icons/admin/star.svg', col, mockLogger, onChange)

    expect(mockLogger.warn).toHaveBeenCalledOnce()
    const msg = mockLogger.warn.mock.calls[0]![0] as string
    expect(msg).toContain('admin-star')
    expect(msg).toContain('UseAdminStar')
    expect(msg).toContain('Restart dev server')
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('does not log unlink warning if the icon is not in the collection', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined)
    // adminCol has no icons
    await handleWatchEvent('unlink', '/icons/admin/ghost.svg', adminCol, mockLogger, onChange)
    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('does not log unlink warning for add or change events', async () => {
    const col = makeCollection('admin', '/icons/admin', ['admin'], [
      { id: 'admin-star', componentName: 'UseAdminStar', absolutePath: '/icons/admin/star.svg' },
    ])
    const onChange = vi.fn().mockResolvedValue(undefined)
    await handleWatchEvent('change', '/icons/admin/star.svg', col, mockLogger, onChange)
    await handleWatchEvent('add', '/icons/admin/star.svg', col, mockLogger, onChange)
    expect(mockLogger.warn).not.toHaveBeenCalled()
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
    setupWatcher(nuxt, { current: collections }, mockLogger, onChange)

    await nuxt.triggerWatch('change', path.relative(rootDir, path.join(iconRoot, 'home.svg')))
    await new Promise(r => setTimeout(r, 150))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].name).toBe('default')
  })

  it('warns and does not call onCollectionChange for SVG outside known collections', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, mockLogger, onChange)

    // Construct a relative path that resolves OUTSIDE all known collection dirs
    const outsideAbs = path.join(os.tmpdir(), 'completely-outside', 'icon.svg')
    const outsideRel = path.relative(iconRoot, outsideAbs)
    await nuxt.triggerWatch('add', outsideRel)
    expect(onChange).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Restart'))
  })

  it('does not call onCollectionChange for non-SVG files', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, mockLogger, onChange)

    await nuxt.triggerWatch('change', 'assets/icons/readme.md')
    expect(onChange).not.toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('routes an uppercase .SVG file change the same as a lowercase one', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, mockLogger, onChange)

    await nuxt.triggerWatch('change', path.relative(rootDir, path.join(iconRoot, 'HOME.SVG')))
    await new Promise(r => setTimeout(r, 150))
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('falls back to resolving against srcDir when rootDir resolution finds no owning collection', async () => {
    // Simulates a Nuxt version where builder:watch reports a path relative to srcDir
    // rather than rootDir, whenever the two differ.
    const wrongRoot = path.join(os.tmpdir(), 'watcher-test-wrong-root')
    const nuxt = makeMockNuxt(wrongRoot, iconRoot)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, mockLogger, onChange)

    const relPath = path.relative(iconRoot, path.join(iconRoot, 'admin', 'star.svg'))
    await nuxt.triggerWatch('change', relPath)
    await new Promise(r => setTimeout(r, 150))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].name).toBe('admin')
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('changes in collection A do not trigger rebuild of collection B', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    setupWatcher(nuxt, { current: collections }, mockLogger, onChange)

    await nuxt.triggerWatch('change', path.relative(rootDir, path.join(iconRoot, 'admin', 'star.svg')))
    await new Promise(r => setTimeout(r, 150))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].name).toBe('admin')
  })

  it('returns a cleanup function that cancels all debounced handlers', () => {
    const nuxt = makeMockNuxt(iconRoot)
    const onChange = vi.fn().mockResolvedValue(undefined)
    const cleanup = setupWatcher(nuxt, { current: collections }, mockLogger, onChange)
    expect(() => cleanup()).not.toThrow()
  })

  it('reads collectionsRef.current live, not a setup-time snapshot (ADR-011 warning uses fresh icons)', async () => {
    const rootDir = iconRoot
    const nuxt = makeMockNuxt(rootDir)
    const onChange = vi.fn().mockResolvedValue(undefined)
    const ref = { current: collections }
    setupWatcher(nuxt, ref, mockLogger, onChange)

    // Mutate the ref after setup, as a rebuild handler would: admin now has an icon.
    const adminWithIcon = makeCollection('admin', path.join(iconRoot, 'admin'), ['admin'], [
      { id: 'admin-star', componentName: 'UseAdminStar', absolutePath: path.join(iconRoot, 'admin', 'star.svg') },
    ])
    ref.current = ref.current.map(c => (c.name === 'admin' ? adminWithIcon : c))

    await nuxt.triggerWatch('unlink', path.relative(rootDir, path.join(iconRoot, 'admin', 'star.svg')))
    await new Promise(r => setTimeout(r, 150))

    // The setup-time snapshot had no icons for admin, so a stale-closure implementation
    // would never find `admin-star` to warn about.
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('admin-star'))
  })
})
