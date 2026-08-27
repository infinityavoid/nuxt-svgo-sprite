import { describe, it, expect } from 'vitest'
import { projectCollections, resolveIconPreviewPath } from '../../src/devtools/devtools'
import type { SpriteCollection } from '../../src/types/types'

function makeCollection(name: string, icons: { id: string, componentName: string, absolutePath: string }[]): SpriteCollection {
  return {
    name,
    segments: name === 'default' ? [] : [name],
    inputDir: `/icons/${name}`,
    spriteComponentName: `${name}Sprite`,
    typeName: `${name}IconName`,
    icons,
  }
}

const iconHome = { id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' }
const iconStar = { id: 'admin-star', componentName: 'UseAdminStar', absolutePath: '/icons/admin/star.svg' }

const defaultCol = makeCollection('default', [iconHome])
const adminCol = makeCollection('admin', [iconStar])
const collections: SpriteCollection[] = [defaultCol, adminCol]

// ─── projectCollections ────────────────────────────────────────────────────────

describe('projectCollections', () => {
  it('projects each collection to a DTO with correct shape', () => {
    const result = projectCollections(collections, new Set(['default']))
    expect(result).toHaveLength(2)

    const def = result[0]!
    expect(def.name).toBe('default')
    expect(def.iconCount).toBe(1)
    expect(def.injected).toBe(true)
    expect(def.icons).toHaveLength(1)
    expect(def.icons[0]).toEqual({ id: 'home', componentName: 'UseHome' })

    const adm = result[1]!
    expect(adm.name).toBe('admin')
    expect(adm.iconCount).toBe(1)
    expect(adm.injected).toBe(false)
    expect(adm.icons[0]).toEqual({ id: 'admin-star', componentName: 'UseAdminStar' })
  })

  it('marks injected correctly based on the set', () => {
    const result = projectCollections(collections, new Set(['admin']))
    expect(result.find(c => c.name === 'admin')!.injected).toBe(true)
    expect(result.find(c => c.name === 'default')!.injected).toBe(false)
  })

  it('returns empty array for empty collections', () => {
    expect(projectCollections([], new Set())).toEqual([])
  })

  it('does not include absolutePath in the DTO', () => {
    const result = projectCollections(collections, new Set())
    for (const col of result) {
      for (const icon of col.icons) {
        expect(icon).not.toHaveProperty('absolutePath')
      }
    }
  })
})

// ─── resolveIconPreviewPath ───────────────────────────────────────────────────

describe('resolveIconPreviewPath', () => {
  it('returns absolutePath for a valid collection + icon id', () => {
    expect(resolveIconPreviewPath('default', 'home', collections)).toBe('/icons/home.svg')
    expect(resolveIconPreviewPath('admin', 'admin-star', collections)).toBe('/icons/admin/star.svg')
  })

  it('returns null for an unknown collection name', () => {
    expect(resolveIconPreviewPath('unknown', 'home', collections)).toBe(null)
  })

  it('returns null for an unknown icon id within a known collection', () => {
    expect(resolveIconPreviewPath('default', 'nonexistent', collections)).toBe(null)
  })

  it('returns null for traversal attempt in collection name', () => {
    expect(resolveIconPreviewPath('../etc', 'passwd', collections)).toBe(null)
  })

  it('returns null for traversal attempt in icon id', () => {
    expect(resolveIconPreviewPath('default', '../passwd', collections)).toBe(null)
  })

  it('returns null for empty collection list', () => {
    expect(resolveIconPreviewPath('default', 'home', [])).toBe(null)
  })
})
