import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { walkInputDir } from '../../src/utils/fs'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>'

function sortEntries(entries: Awaited<ReturnType<typeof walkInputDir>>) {
  return entries
    .map(e => ({ segments: e.segments.slice().sort(), files: e.files.slice().sort() }))
    .sort((a, b) => a.segments.join('/').localeCompare(b.segments.join('/')))
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'svgo-sprite-fs-test-'))
})

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

async function writeSvg(...parts: string[]) {
  const filePath = path.join(tmpDir, ...parts)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, SVG, 'utf-8')
  return filePath
}

describe('walkInputDir', () => {
  it('assigns root-level SVGs to default collection (segments [])', async () => {
    const file = await writeSvg('home.svg')
    const entries = await walkInputDir(tmpDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.segments).toEqual([])
    expect(entries[0]!.files).toContain(file)
  })

  it('assigns SVGs in named subfolder to that collection', async () => {
    const file = await writeSvg('admin', 'star.svg')
    const entries = await walkInputDir(tmpDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.segments).toEqual(['admin'])
    expect(entries[0]!.files).toContain(file)
  })

  it('assigns SVGs in nested subfolder to correct segments', async () => {
    const file = await writeSvg('admin', 'buttons', 'close.svg')
    const entries = await walkInputDir(tmpDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.segments).toEqual(['admin', 'buttons'])
    expect(entries[0]!.files).toContain(file)
  })

  it('merges default/ subfolder SVGs into default collection', async () => {
    const rootFile = await writeSvg('home.svg')
    const defaultFile = await writeSvg('default', 'extra.svg')
    const entries = await walkInputDir(tmpDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.segments).toEqual([])
    expect(entries[0]!.files).toContain(rootFile)
    expect(entries[0]!.files).toContain(defaultFile)
  })

  it('produces multiple collections from multiple subfolders', async () => {
    await writeSvg('home.svg')
    await writeSvg('admin', 'star.svg')
    await writeSvg('admin', 'buttons', 'close.svg')
    const entries = sortEntries(await walkInputDir(tmpDir))
    expect(entries).toHaveLength(3)
    const segmentSets = entries.map(e => e.segments)
    expect(segmentSets).toContainEqual([])
    expect(segmentSets).toContainEqual(['admin'])
    expect(segmentSets).toContainEqual(['admin', 'buttons'])
  })

  it('ignores non-SVG files', async () => {
    await writeSvg('home.svg')
    await fsp.writeFile(path.join(tmpDir, 'readme.txt'), 'hello')
    const entries = await walkInputDir(tmpDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.files.every(f => f.endsWith('.svg'))).toBe(true)
  })

  it('produces no entries for empty folders', async () => {
    await fsp.mkdir(path.join(tmpDir, 'empty-folder'))
    const entries = await walkInputDir(tmpDir)
    expect(entries).toHaveLength(0)
  })

  it('produces no entries when inputDir has no SVGs at any level', async () => {
    await fsp.writeFile(path.join(tmpDir, 'notes.md'), '# hi')
    const entries = await walkInputDir(tmpDir)
    expect(entries).toHaveLength(0)
  })

  it('returns empty array when inputDir does not exist', async () => {
    const entries = await walkInputDir(path.join(tmpDir, 'nonexistent'))
    expect(entries).toEqual([])
  })

  it('skips symlinks', async () => {
    // Symlink creation requires elevated privileges on Windows without Developer Mode
    if (process.platform === 'win32') return

    const realFile = await writeSvg('home.svg')
    const linkPath = path.join(tmpDir, 'link.svg')
    await fsp.symlink(realFile, linkPath)

    const entries = await walkInputDir(tmpDir)
    expect(entries).toHaveLength(1)
    const files = entries[0]!.files
    expect(files).not.toContain(linkPath)
    expect(files).toContain(realFile)
  })

  it('default/ subdirectories create their own named collections', async () => {
    // SVGs inside default/subdir/ → segments ['subdir'], not default
    const file = await writeSvg('default', 'sub', 'icon.svg')
    const entries = await walkInputDir(tmpDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.segments).toEqual(['sub'])
    expect(entries[0]!.files).toContain(file)
  })
})
