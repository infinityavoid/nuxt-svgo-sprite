import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveInjectCollections } from '../../src/plugins/auto-inject'
import type { SpriteCollection } from '../../src/types/types'

function makeCollection(name: string): SpriteCollection {
  return {
    name,
    segments: name === 'default' ? [] : [name],
    inputDir: `/icons/${name}`,
    sources: [{ dir: `/icons/${name}`, label: '(root)' }],
    spriteComponentName: `${name.charAt(0).toUpperCase() + name.slice(1)}Sprite`,
    typeName: `${name.charAt(0).toUpperCase() + name.slice(1)}IconName`,
    icons: [],
  }
}

const defaultCol = makeCollection('default')
const adminCol = makeCollection('admin')
const paymentsCol = makeCollection('payments')
const collections = [defaultCol, adminCol, paymentsCol]

const mockLogger = { warn: vi.fn() }
beforeEach(() => vi.clearAllMocks())

describe('resolveInjectCollections', () => {
  it('returns all collections when opt is true', () => {
    const result = resolveInjectCollections(true, collections, mockLogger)
    expect(result).toEqual(collections)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('filters to only the named collections', () => {
    const result = resolveInjectCollections(['admin', 'payments'], collections, mockLogger)
    expect(result).toHaveLength(2)
    expect(result.map(c => c.name)).toEqual(['admin', 'payments'])
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('returns empty array when no named collection matches', () => {
    const result = resolveInjectCollections(['unknown'], collections, mockLogger)
    expect(result).toHaveLength(0)
  })

  it('warns for each unknown collection name', () => {
    resolveInjectCollections(['admin', 'ghost', 'phantom'], collections, mockLogger)
    expect(mockLogger.warn).toHaveBeenCalledTimes(2)
    const msgs = mockLogger.warn.mock.calls.map(c => c[0] as string)
    expect(msgs[0]).toContain('ghost')
    expect(msgs[1]).toContain('phantom')
  })

  it('warn message lists all known collection names', () => {
    resolveInjectCollections(['unknown'], collections, mockLogger)
    const msg = mockLogger.warn.mock.calls[0]![0] as string
    expect(msg).toContain('default')
    expect(msg).toContain('admin')
    expect(msg).toContain('payments')
  })

  it('returns empty array when opt is an empty array', () => {
    const result = resolveInjectCollections([], collections, mockLogger)
    expect(result).toHaveLength(0)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})
