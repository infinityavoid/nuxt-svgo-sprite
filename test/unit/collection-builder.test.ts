import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildCollectionsFromDir, rebuildSingleCollection } from '../../src/builders/collection-builder'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'svgo-sprite-coll-test-'))
})

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

const mockLogger = { warn: vi.fn() }
beforeEach(() => vi.clearAllMocks())

async function writeSvg(...parts: string[]) {
  const filePath = path.join(tmpDir, ...parts)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, SVG, 'utf-8')
  return filePath
}

describe('buildCollectionsFromDir', () => {
  it('root-level SVGs produce the default collection', async () => {
    await writeSvg('home.svg')
    await writeSvg('close.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    expect(cols).toHaveLength(1)
    const [col] = cols
    expect(col!.name).toBe('default')
    expect(col!.segments).toEqual([])
    expect(col!.inputDir).toBe(tmpDir)
    expect(col!.spriteComponentName).toBe('DefaultSprite')
    expect(col!.typeName).toBe('DefaultIconName')
    expect(col!.icons).toHaveLength(2)
    expect(col!.icons.map(i => i.id)).toEqual(expect.arrayContaining(['home', 'close']))
  })

  it('default/ subfolder SVGs merge into the default collection', async () => {
    await writeSvg('home.svg')
    await writeSvg('default', 'extra.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    expect(cols).toHaveLength(1)
    const ids = cols[0]!.icons.map(i => i.id)
    expect(ids).toContain('home')
    expect(ids).toContain('extra')
  })

  it('named subfolder produces a named collection with correct metadata', async () => {
    await writeSvg('admin', 'star.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    expect(cols).toHaveLength(1)
    const [col] = cols
    expect(col!.name).toBe('admin')
    expect(col!.segments).toEqual(['admin'])
    expect(col!.inputDir).toBe(path.join(tmpDir, 'admin'))
    expect(col!.spriteComponentName).toBe('AdminSprite')
    expect(col!.typeName).toBe('AdminIconName')
    expect(col!.icons).toHaveLength(1)
    expect(col!.icons[0]!.id).toBe('admin-star')
    expect(col!.icons[0]!.componentName).toBe('UseAdminStar')
  })

  it('nested subfolder produces a collection with compound camelCase name', async () => {
    await writeSvg('admin', 'buttons', 'close.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    expect(cols).toHaveLength(1)
    const [col] = cols
    expect(col!.name).toBe('adminButtons')
    expect(col!.segments).toEqual(['admin', 'buttons'])
    expect(col!.icons[0]!.id).toBe('admin-buttons-close')
    expect(col!.icons[0]!.componentName).toBe('UseAdminButtonsClose')
  })

  it('a subfolder nested under default/ gets an inputDir that actually exists on disk', async () => {
    // Regression: walkInputDir strips the leading "default" segment for NAMING
    // purposes (default/sub/icon.svg -> segments ["sub"]), but rejoining just those
    // segments onto the root used to point inputDir at "<root>/sub" — a directory
    // that was never created — instead of the real "<root>/default/sub". That broke
    // the watcher (it could never find this collection's files again) and HMR
    // rebuilds (rebuildSingleCollection would read a nonexistent dir and silently
    // return zero icons).
    await writeSvg('default', 'sub', 'icon.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    expect(cols).toHaveLength(1)
    expect(cols[0]!.name).toBe('sub')
    const realDir = path.join(tmpDir, 'default', 'sub')
    expect(cols[0]!.inputDir).toBe(realDir)
    await expect(fsp.access(cols[0]!.inputDir)).resolves.toBeUndefined()
  })

  it('multiple subfolders produce multiple independent collections', async () => {
    await writeSvg('home.svg')
    await writeSvg('admin', 'star.svg')
    await writeSvg('admin', 'buttons', 'close.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    expect(cols).toHaveLength(3)
    const names = cols.map(c => c.name)
    expect(names).toContain('default')
    expect(names).toContain('admin')
    expect(names).toContain('adminButtons')
  })

  it('empty folder creates no collection', async () => {
    await fsp.mkdir(path.join(tmpDir, 'empty'))
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    expect(cols).toHaveLength(0)
  })

  it('returns empty array when inputDir does not exist', async () => {
    const cols = await buildCollectionsFromDir(path.join(tmpDir, 'nonexistent'), 'Use', mockLogger)
    expect(cols).toHaveLength(0)
  })

  it('warns and skips second icon on id collision within a collection', async () => {
    // Both normalize to id 'home'; home_.svg also triggers a sanitization warn
    await writeSvg('home.svg')
    await writeSvg('home_.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    // Expects at least the collision warn (home_.svg also triggers a sanitization warn)
    expect(mockLogger.warn).toHaveBeenCalledTimes(2)
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('collision'))
    expect(cols[0]!.icons).toHaveLength(1)
  })

  it('uses buildIconMeta — icons carry correct absolutePath', async () => {
    const filePath = await writeSvg('star.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    expect(cols[0]!.icons[0]!.absolutePath).toBe(filePath)
  })

  it('respects custom componentPrefix', async () => {
    await writeSvg('star.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Icon', mockLogger)
    expect(cols[0]!.icons[0]!.componentName).toBe('IconStar')
  })

  it('folder with uppercase name: id and collection name are lowercased', async () => {
    await writeSvg('Admin', 'star.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    expect(cols).toHaveLength(1)
    expect(cols[0]!.name).toBe('admin')
    expect(cols[0]!.icons[0]!.id).toBe('admin-star')
  })

  it('folder with underscores: normalized to hyphens in id', async () => {
    await writeSvg('my_folder', 'star.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    expect(cols).toHaveLength(1)
    expect(cols[0]!.name).toBe('myFolder')
    expect(cols[0]!.icons[0]!.id).toBe('my-folder-star')
  })

  it('folder with spaces: normalized to hyphens in id', async () => {
    await writeSvg('admin buttons', 'star.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    expect(cols).toHaveLength(1)
    expect(cols[0]!.name).toBe('adminButtons')
    expect(cols[0]!.icons[0]!.id).toBe('admin-buttons-star')
  })

  it('folder with only special chars: warns and skips the entry', async () => {
    await writeSvg('@@@', 'star.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    expect(cols).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('@@@'))
  })

  it('filename with non-standard chars: warns about normalization', async () => {
    await writeSvg('My Icon.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    expect(cols).toHaveLength(1)
    expect(mockLogger.warn).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('My Icon.svg'))
    expect(cols[0]!.icons[0]!.id).toBe('my-icon')
  })

  it('a filename with no usable characters after normalization is skipped with a warning', async () => {
    await writeSvg('звезда.svg')
    await writeSvg('home.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    expect(cols).toHaveLength(1)
    expect(cols[0]!.icons).toHaveLength(1)
    expect(cols[0]!.icons[0]!.id).toBe('home')
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('звезда.svg'))
  })

  it('two folders that sanitize to the same collection name: the later one is skipped with a warning', async () => {
    await writeSvg('admin-icons', 'star.svg')
    await writeSvg('admin_icons', 'close.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    expect(cols).toHaveLength(1)
    expect(cols[0]!.name).toBe('adminIcons')
    expect(cols[0]!.icons).toHaveLength(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Collection name collision'))
  })

  it('a folder named "Default" (any case) merges into the default collection like "default" does — no icons lost, no collision', async () => {
    // Regression: this used to reach the cross-collection name-collision pass, which
    // (before the case-insensitive fix in utils/fs.ts) dropped ALL root-level icons,
    // not the "Default" folder's — an unrecoverable data-loss regression, since the
    // warning told the user to "rename (root)", which isn't a folder they can rename.
    await writeSvg('home.svg')
    await writeSvg('Default', 'extra.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    expect(cols).toHaveLength(1)
    expect(cols[0]!.name).toBe('default')
    expect(cols[0]!.icons.map(i => i.id).sort()).toEqual(['extra', 'home'])
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('root icons survive a genuine collection-name collision — the root always wins, the other folder is skipped', async () => {
    // A collision that ISN'T resolved by the default/-merge rule above (e.g. two
    // differently-cased/spelled names that both sanitize to a name equal to root's
    // "default") must never silently drop root-level icons — that's unrecoverable,
    // since there's no "(root)" folder a user could rename to fix it.
    await writeSvg('home.svg')
    await writeSvg('  Default  ', 'extra.svg') // sanitizes to "default" too, via a path fs.ts's literal check misses
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    const defaultCol = cols.find(c => c.name === 'default')!
    expect(defaultCol.icons.map(i => i.id)).toEqual(['home'])
    const [message] = mockLogger.warn.mock.calls[0]!
    expect(message).toContain('Collection name collision')
    // The instruction must point at the renameable folder, never at "(root)".
    expect(message).toMatch(/Rename "\s*Default\s*"/)
    expect(message).not.toMatch(/Rename "\(root\)"/)
  })

  it('two collections whose icons derive the same symbol id: the later icon is skipped with a warning', async () => {
    await writeSvg('admin', 'star.svg')
    await writeSvg('admin-star.svg') // root file, id "admin-star" — collides with admin/star.svg
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    const allIds = cols.flatMap(c => c.icons.map(i => i.id))
    expect(allIds.filter(id => id === 'admin-star')).toHaveLength(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Symbol id collision'))
  })
})

describe('rebuildSingleCollection', () => {
  it('reflects an added file the same way a cold build would', async () => {
    await writeSvg('admin', 'star.svg')
    const cold = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    const adminCol = cold.find(c => c.name === 'admin')!

    await writeSvg('admin', 'close.svg')
    const updated = await rebuildSingleCollection(adminCol, 'Use', mockLogger)

    expect(updated.icons.map(i => i.id).sort()).toEqual(['admin-close', 'admin-star'])
  })

  it('reflects a removed file the same way a cold build would', async () => {
    await writeSvg('admin', 'star.svg')
    const starPath = await writeSvg('admin', 'close.svg')
    const cold = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    const adminCol = cold.find(c => c.name === 'admin')!

    await fsp.rm(starPath)
    const updated = await rebuildSingleCollection(adminCol, 'Use', mockLogger)

    expect(updated.icons.map(i => i.id)).toEqual(['admin-star'])
  })

  it('a subfolder literally named "default" inside a named collection is NOT reinterpreted as that collection\'s merge folder on rebuild', async () => {
    // Regression: rebuildSingleCollection used to reuse walkInputDir's root-relative
    // "default/ merges into default" rule against an arbitrary collection subtree,
    // misclassifying admin/default/x.svg as a direct file of "admin" after a rebuild
    // even though a cold build assigns it to the separate "adminDefault" collection.
    await writeSvg('admin', 'star.svg')
    await writeSvg('admin', 'default', 'extra.svg')
    const cold = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    const coldAdmin = cold.find(c => c.name === 'admin')!
    const coldAdminDefault = cold.find(c => c.name === 'adminDefault')!
    expect(coldAdmin.icons.map(i => i.id)).toEqual(['admin-star'])
    expect(coldAdminDefault.icons.map(i => i.id)).toEqual(['admin-default-extra'])

    // Touch a file in admin/ to trigger a rebuild of just that collection.
    const rebuiltAdmin = await rebuildSingleCollection(coldAdmin, 'Use', mockLogger)
    expect(rebuiltAdmin.icons.map(i => i.id)).toEqual(['admin-star'])
  })

  it('the default collection still merges inputDir/default/ files on rebuild', async () => {
    await writeSvg('home.svg')
    await writeSvg('default', 'extra.svg')
    const cold = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    const defaultCol = cold.find(c => c.name === 'default')!
    expect(defaultCol.icons.map(i => i.id).sort()).toEqual(['extra', 'home'])

    await writeSvg('another.svg')
    const updated = await rebuildSingleCollection(defaultCol, 'Use', mockLogger)
    expect(updated.icons.map(i => i.id).sort()).toEqual(['another', 'extra', 'home'])
  })

  it('does not warn when the optional inputDir/default/ merge folder does not exist', async () => {
    await writeSvg('home.svg')
    const cold = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    const defaultCol = cold.find(c => c.name === 'default')!
    vi.clearAllMocks()

    await rebuildSingleCollection(defaultCol, 'Use', mockLogger)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})
