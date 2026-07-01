import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildCollectionsFromDir } from '../../src/builders/collection-builder'

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
    // Both normalize to id 'home'
    await writeSvg('home.svg')
    await writeSvg('home_.svg')
    const cols = await buildCollectionsFromDir(tmpDir, 'Use', mockLogger)

    expect(mockLogger.warn).toHaveBeenCalledOnce()
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
})
