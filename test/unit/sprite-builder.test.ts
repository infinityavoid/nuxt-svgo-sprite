import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  defaultSpriteConfig,
  buildSpriteConfig,
  extractSprite,
  buildSprite,
} from '../../src/builders/sprite-builder'
import type { IconMeta } from '../../src/types/types'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'svgo-sprite-builder-test-'))
})

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}

beforeEach(() => vi.clearAllMocks())

async function makeIcon(id: string, filename = id): Promise<IconMeta> {
  const filePath = path.join(tmpDir, `${filename}.svg`)
  await fsp.writeFile(filePath, SVG, 'utf-8')
  return { id, componentName: `Use${id}`, absolutePath: filePath }
}

// ─── buildSpriteConfig ────────────────────────────────────────────────────────

describe('buildSpriteConfig', () => {
  it('returns the same object when optimizeFiles is true', () => {
    expect(buildSpriteConfig(defaultSpriteConfig, true)).toBe(defaultSpriteConfig)
  })

  it('sets shape.transform to [] when optimizeFiles is false', () => {
    const config = buildSpriteConfig(defaultSpriteConfig, false)
    expect(config.shape?.transform).toEqual([])
  })

  it('preserves other shape keys when disabling optimization', () => {
    const base = {
      ...defaultSpriteConfig,
      shape: {
        ...defaultSpriteConfig.shape,
        dimension: { maxWidth: 1000, maxHeight: 1000 },
      },
    }
    const config = buildSpriteConfig(base, false)
    expect(config.shape?.transform).toEqual([])
    expect(config.shape?.dimension).toEqual({ maxWidth: 1000, maxHeight: 1000 })
  })

  it('does not mutate the original config', () => {
    const original = { ...defaultSpriteConfig, shape: { transform: ['svgo'] as ['svgo'] } }
    buildSpriteConfig(original, false)
    expect(original.shape.transform).toEqual(['svgo'])
  })
})

// ─── extractSprite ────────────────────────────────────────────────────────────

describe('extractSprite', () => {
  it('returns the sprite string from a well-formed result', () => {
    const result = { symbol: { sprite: { contents: Buffer.from('<svg>ok</svg>') } } }
    expect(extractSprite(result, mockLogger)).toBe('<svg>ok</svg>')
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('returns empty string and logs error when result is null', () => {
    expect(extractSprite(null, mockLogger)).toBe('')
    expect(mockLogger.error).toHaveBeenCalledOnce()
  })

  it('returns empty string and logs error when symbol key is missing', () => {
    expect(extractSprite({}, mockLogger)).toBe('')
    expect(mockLogger.error).toHaveBeenCalledOnce()
  })

  it('returns empty string and logs error when sprite key is missing', () => {
    expect(extractSprite({ symbol: {} }, mockLogger)).toBe('')
    expect(mockLogger.error).toHaveBeenCalledOnce()
  })

  it('returns empty string and logs error when contents is missing', () => {
    expect(extractSprite({ symbol: { sprite: {} } }, mockLogger)).toBe('')
    expect(mockLogger.error).toHaveBeenCalledOnce()
  })
})

// ─── buildSprite ──────────────────────────────────────────────────────────────

describe('buildSprite', () => {
  it('produces a sprite containing the expected symbol ids', async () => {
    const icons = [await makeIcon('home'), await makeIcon('star')]
    const sprite = await buildSprite(icons, defaultSpriteConfig, true, mockLogger)
    expect(sprite).toContain('id="home"')
    expect(sprite).toContain('id="star"')
  })

  it('uses icon.id (not the filename) as the symbol id', async () => {
    // The file on disk is star.svg but the computed id is admin-star
    const icon = await makeIcon('admin-star', 'star')
    const sprite = await buildSprite([icon], defaultSpriteConfig, true, mockLogger)
    expect(sprite).toContain('id="admin-star"')
    expect(sprite).not.toContain('id="star"')
  })

  it('returns empty string and warns when icons array is empty', async () => {
    const sprite = await buildSprite([], defaultSpriteConfig, true, mockLogger)
    expect(sprite).toBe('')
    expect(mockLogger.warn).toHaveBeenCalledOnce()
  })

  it('optimizeFiles: false — still produces a valid sprite with correct id', async () => {
    const icon = await makeIcon('check')
    const sprite = await buildSprite([icon], defaultSpriteConfig, false, mockLogger)
    expect(sprite).toContain('id="check"')
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('handles multiple icons with collection-prefixed ids', async () => {
    const icons = [
      await makeIcon('admin-star', 'star'),
      await makeIcon('admin-close', 'close'),
    ]
    const sprite = await buildSprite(icons, defaultSpriteConfig, true, mockLogger)
    expect(sprite).toContain('id="admin-star"')
    expect(sprite).toContain('id="admin-close"')
  })
})
