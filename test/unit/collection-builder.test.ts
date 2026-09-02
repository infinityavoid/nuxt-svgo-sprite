import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildCollectionsFromDir, rebuildSingleCollection } from '../../src/builders/collection-builder'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>'

let tmpDir: string
let layerDir: string

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'svgo-sprite-coll-test-'))
  layerDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'svgo-sprite-coll-test-layer-'))
})

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
  await fsp.rm(layerDir, { recursive: true, force: true })
})

const mockLogger = { warn: vi.fn(), info: vi.fn() }
beforeEach(() => vi.clearAllMocks())

async function writeSvg(...parts: string[]) {
  const filePath = path.join(tmpDir, ...parts)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, SVG, 'utf-8')
  return filePath
}

async function writeSvgIn(root: string, ...parts: string[]) {
  const filePath = path.join(root, ...parts)
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

// ── same-collection (cross-root) collision is info, not a false "another collection" warning ──

describe('buildCollectionsFromDir — collision message discrimination', () => {
  it('cold build, two roots, same id in the SAME collection: an informational shadow message, never "rename"/"another collection"', async () => {
    await writeSvg('close.svg')
    await writeSvgIn(layerDir, 'close.svg')
    const cols = await buildCollectionsFromDir(
      [{ dir: tmpDir, label: '(root)' }, { dir: layerDir, label: 'layer "base-layer"' }],
      'Use',
      mockLogger,
    )

    const defaultCol = cols.find(c => c.name === 'default')!
    expect(defaultCol.icons.map(i => i.id)).toEqual(['close'])
    expect(defaultCol.icons[0]!.absolutePath).toBe(path.join(tmpDir, 'close.svg'))

    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledOnce()
    const [message] = mockLogger.info.mock.calls[0]!
    // These two negative assertions are the actual regression guard: a same-
    // collection shadow must never say "another collection" (factually wrong — it's
    // the SAME collection) or tell the user to rename a file, which would break the
    // layer-override feature.
    expect(message).not.toMatch(/rename/i)
    expect(message).not.toContain('another collection')
    expect(message).toContain('more than one source')
  })

  it('cold build, genuinely different collections colliding: still a warning, now naming the owning (winning) collection', async () => {
    await writeSvg('admin', 'star.svg')
    await writeSvg('admin-star.svg') // root file, id "admin-star" — collides with admin/star.svg
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    // The root-level "default" collection is processed first (intra-root pass
    // prioritizes the root's own collection — see buildCollectionsFromDir), so it
    // wins this collision; "admin"'s star.svg is the one skipped.
    const defaultCol = cols.find(c => c.name === 'default')!
    expect(defaultCol.icons.map(i => i.id)).toEqual(['admin-star'])
    expect(cols.find(c => c.name === 'admin')).toBeUndefined()

    expect(mockLogger.info).not.toHaveBeenCalled()
    const [message] = mockLogger.warn.mock.calls.find(([m]) => (m as string).includes('Symbol id collision'))!
    expect(message).toContain('in collection "admin"')
    expect(message).toContain('used by collection "default"')
    expect(message).toMatch(/rename/i)
  })

  it('one build with BOTH a same-collection shadow and a genuine cross-collection clash: exactly one info, exactly one warn', async () => {
    // Shadowed within "default": app + layer both ship close.svg.
    await writeSvg('close.svg')
    await writeSvgIn(layerDir, 'close.svg')
    // Genuine cross-collection clash, unrelated to layers: admin/star.svg vs root admin-star.svg.
    await writeSvg('admin', 'star.svg')
    await writeSvg('admin-star.svg')

    await buildCollectionsFromDir(
      [{ dir: tmpDir, label: '(root)' }, { dir: layerDir, label: 'layer "base-layer"' }],
      'Use',
      mockLogger,
    )

    expect(mockLogger.info).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledOnce()
  })

  it('an id first claimed by collection A does not get treated as a same-collection shadow when a DIFFERENT collection B derives the same id from another root', async () => {
    // "admin/star.svg" (app root) derives id "admin-star", in collection "admin".
    // A LAYER-root file "admin-star.svg" at the layer's tree root derives the SAME
    // id "admin-star", but lands in collection "default" — a genuinely different
    // collection, contributed by a different root. Must be the cross-collection warn
    // naming "admin", not the same-collection shadow info, even though both icons
    // came from different roots (which is what a naive "any cross-root collision is
    // a shadow" implementation would get wrong).
    await writeSvg('admin', 'star.svg')
    await writeSvgIn(layerDir, 'admin-star.svg')
    await buildCollectionsFromDir(
      [{ dir: tmpDir, label: '(root)' }, { dir: layerDir, label: 'layer "base-layer"' }],
      'Use',
      mockLogger,
    )

    expect(mockLogger.info).not.toHaveBeenCalled()
    const [message] = mockLogger.warn.mock.calls.find(([m]) => (m as string).includes('Symbol id collision'))!
    expect(message).toContain('in collection "default"')
    expect(message).toContain('used by collection "admin"')
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

// ── multi-root (layer-merged) collections survive HMR ──────────────────────────

describe('buildCollectionsFromDir with multiple roots — sources tracking', () => {
  it('a single-root collection has exactly one source, equal to inputDir', async () => {
    await writeSvg('home.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)
    expect(cols[0]!.sources).toEqual([{ dir: tmpDir, label: '(root)' }])
  })

  it('cold build over 2 roots: merged collection has both sources, app first', async () => {
    await writeSvg('home.svg')
    await writeSvgIn(layerDir, 'check.svg')

    const roots = [
      { dir: tmpDir, label: '(root)' },
      { dir: layerDir, label: 'layer "base-layer"' },
    ]
    const cols = await buildCollectionsFromDir(roots, 'Use', mockLogger)

    const defaultCol = cols.find(c => c.name === 'default')!
    expect(defaultCol.sources).toEqual([
      { dir: tmpDir, label: '(root)' },
      { dir: layerDir, label: 'layer "base-layer"' },
    ])
    expect(defaultCol.inputDir).toBe(tmpDir)
    expect(defaultCol.icons.map(i => i.id).sort()).toEqual(['check', 'home'])
  })
})

describe('rebuildSingleCollection with a multi-source (layer-merged) collection', () => {
  const roots = () => [
    { dir: tmpDir, label: '(root)' },
    { dir: layerDir, label: 'layer "base-layer"' },
  ]

  it('THE REGRESSION: adding an icon in the APP root does not drop the layer\'s icons', async () => {
    await writeSvg('home.svg')
    await writeSvgIn(layerDir, 'check.svg')
    const cold = await buildCollectionsFromDir(roots(), 'Use', mockLogger)
    const defaultCol = cold.find(c => c.name === 'default')!
    expect(defaultCol.icons.map(i => i.id).sort()).toEqual(['check', 'home'])

    // Trigger exactly what the watcher does on an app-folder edit: rebuild the
    // collection from its own (now multi-source) record — nothing about this edit
    // touches the layer at all.
    await writeSvg('star.svg')
    const rebuilt = await rebuildSingleCollection(defaultCol, 'Use', mockLogger)

    expect(rebuilt.icons.map(i => i.id).sort()).toEqual(['check', 'home', 'star'])
  })

  it('adding an icon in the LOWER-priority (layer) root is picked up on rebuild, not just at cold build', async () => {
    await writeSvg('home.svg')
    await writeSvgIn(layerDir, 'check.svg')
    const cold = await buildCollectionsFromDir(roots(), 'Use', mockLogger)
    const defaultCol = cold.find(c => c.name === 'default')!

    await writeSvgIn(layerDir, 'bell.svg')
    const rebuilt = await rebuildSingleCollection(defaultCol, 'Use', mockLogger)

    expect(rebuilt.icons.map(i => i.id).sort()).toEqual(['bell', 'check', 'home'])
  })

  it('both roots shipping the same id: the app\'s wins on rebuild, with an informational shadow message, not a silent duplicate', async () => {
    await writeSvg('close.svg')
    await writeSvgIn(layerDir, 'other.svg')
    const cold = await buildCollectionsFromDir(roots(), 'Use', mockLogger)
    const defaultCol = cold.find(c => c.name === 'default')!

    // Layer now also ships a "close" icon — collides with the app's. This is the
    // SAME collection ("default"), just two sources — an expected override, not a
    // mistake, so it routes to logger.info, not logger.warn.
    await writeSvgIn(layerDir, 'close.svg')
    vi.clearAllMocks()
    const rebuilt = await rebuildSingleCollection(defaultCol, 'Use', mockLogger)

    const closeIcons = rebuilt.icons.filter(i => i.id === 'close')
    expect(closeIcons).toHaveLength(1)
    expect(closeIcons[0]!.absolutePath).toBe(path.join(tmpDir, 'close.svg'))
    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('more than one source'))
  })

  it('a named collection present in both roots rebuilds with icons from both', async () => {
    await writeSvg('admin', 'star.svg')
    await writeSvgIn(layerDir, 'admin', 'shield.svg')
    const cold = await buildCollectionsFromDir(roots(), 'Use', mockLogger)
    const adminCol = cold.find(c => c.name === 'admin')!
    expect(adminCol.icons.map(i => i.id).sort()).toEqual(['admin-shield', 'admin-star'])

    await writeSvg('admin', 'gear.svg')
    const rebuilt = await rebuildSingleCollection(adminCol, 'Use', mockLogger)

    expect(rebuilt.icons.map(i => i.id).sort()).toEqual(['admin-gear', 'admin-shield', 'admin-star'])
  })

  it('the default/ merge folder is honored for every source, not just the highest-priority one', async () => {
    await writeSvg('home.svg')
    await writeSvgIn(layerDir, 'check.svg')
    const cold = await buildCollectionsFromDir(roots(), 'Use', mockLogger)
    const defaultCol = cold.find(c => c.name === 'default')!

    await writeSvgIn(layerDir, 'default', 'extra.svg')
    const rebuilt = await rebuildSingleCollection(defaultCol, 'Use', mockLogger)

    expect(rebuilt.icons.map(i => i.id).sort()).toEqual(['check', 'extra', 'home'])
  })

  it('a collection that exists ONLY in the layer still rebuilds correctly from it', async () => {
    await writeSvg('home.svg')
    await writeSvgIn(layerDir, 'brand', 'logo.svg')
    const cold = await buildCollectionsFromDir(roots(), 'Use', mockLogger)
    const brandCol = cold.find(c => c.name === 'brand')!
    expect(brandCol.sources).toEqual([{ dir: path.join(layerDir, 'brand'), label: 'layer "base-layer"' }])

    await writeSvgIn(layerDir, 'brand', 'mark.svg')
    const rebuilt = await rebuildSingleCollection(brandCol, 'Use', mockLogger)

    expect(rebuilt.icons.map(i => i.id).sort()).toEqual(['brand-logo', 'brand-mark'])
  })
})
