import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findOwningCollection, handleWatchEvent } from '../../src/watcher/watcher'
import type { SpriteCollection } from '../../src/types/types'

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
