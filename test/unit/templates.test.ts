import { describe, it, expect } from 'vitest'
import { buildIconTypesContent } from '../../src/templates/templates'
import type { SpriteCollection } from '../../src/types/types'

function makeCol(
  name: string,
  typeName: string,
  ids: string[],
): SpriteCollection {
  return {
    name,
    segments: name === 'default' ? [] : name.split('-'),
    inputDir: `/icons/${name === 'default' ? '' : name}`,
    spriteComponentName: name === 'default' ? 'DefaultSprite' : `${name.charAt(0).toUpperCase() + name.slice(1)}Sprite`,
    typeName,
    icons: ids.map(id => ({
      id,
      componentName: `Use${id.charAt(0).toUpperCase() + id.slice(1)}`,
      absolutePath: `/icons/${id}.svg`,
    })),
  }
}

describe('buildIconTypesContent', () => {
  it('generates a named type export for a single collection', () => {
    const content = buildIconTypesContent([makeCol('default', 'DefaultIconName', ['home', 'close'])])
    expect(content).toContain('export type DefaultIconName = "home" | "close"')
  })

  it('generates AllIconName as union of all collection type names', () => {
    const content = buildIconTypesContent([
      makeCol('default', 'DefaultIconName', ['home']),
      makeCol('admin', 'AdminIconName', ['admin-star']),
    ])
    expect(content).toContain('export type AllIconName = DefaultIconName | AdminIconName')
  })

  it('multiple collections each get their own type export', () => {
    const content = buildIconTypesContent([
      makeCol('default', 'DefaultIconName', ['home']),
      makeCol('admin', 'AdminIconName', ['admin-star']),
      makeCol('adminButtons', 'AdminButtonsIconName', ['admin-buttons-close']),
    ])
    expect(content).toContain('export type DefaultIconName')
    expect(content).toContain('export type AdminIconName')
    expect(content).toContain('export type AdminButtonsIconName')
    expect(content).toContain(
      'export type AllIconName = DefaultIconName | AdminIconName | AdminButtonsIconName',
    )
  })

  it('uses never for a collection with no icons', () => {
    const content = buildIconTypesContent([makeCol('default', 'DefaultIconName', [])])
    expect(content).toContain('export type DefaultIconName = never')
  })

  it('uses never for AllIconName when collections array is empty', () => {
    const content = buildIconTypesContent([])
    expect(content).toContain('export type AllIconName = never')
    expect(content).not.toContain('DefaultIconName')
  })

  it('icon ids are emitted as JSON string literals', () => {
    const content = buildIconTypesContent([
      makeCol('admin', 'AdminIconName', ['admin-star', 'admin-close']),
    ])
    expect(content).toContain('"admin-star"')
    expect(content).toContain('"admin-close"')
  })

  it('each type export is on its own line', () => {
    const content = buildIconTypesContent([
      makeCol('default', 'DefaultIconName', ['home']),
      makeCol('admin', 'AdminIconName', ['admin-star']),
    ])
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(3) // DefaultIconName, AdminIconName, AllIconName
  })

  it('output ends with a newline', () => {
    const content = buildIconTypesContent([makeCol('default', 'DefaultIconName', ['home'])])
    expect(content.endsWith('\n')).toBe(true)
  })
})
