import { describe, it, expect, vi } from 'vitest'
import { addTemplate, addComponent } from '@nuxt/kit'
import { buildIconTypesContent, registerUseComponent } from '../../src/templates/templates'
import type { SpriteCollection } from '../../src/types/types'

vi.mock('@nuxt/kit', () => ({
  addTemplate: vi.fn((opts: { filename: string, getContents: () => string }) => ({ dst: `/build/${opts.filename}` })),
  addComponent: vi.fn(),
}))

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
    const exportLines = content.split('\n').filter(l => l.startsWith('export type'))
    expect(exportLines).toHaveLength(3) // DefaultIconName, AdminIconName, AllIconName
  })

  it('each type export has a preceding JSDoc block', () => {
    const content = buildIconTypesContent([makeCol('default', 'DefaultIconName', ['home'])])
    expect(content).toContain('/**')
    expect(content).toContain('@example')
  })

  it('output ends with a newline', () => {
    const content = buildIconTypesContent([makeCol('default', 'DefaultIconName', ['home'])])
    expect(content.endsWith('\n')).toBe(true)
  })
})

describe('registerUseComponent', () => {
  it('generates a real newline between </template> and <script setup>', () => {
    // Regression: a bare `</template><script setup lang="ts">` on one line makes
    // vue-tsc fail the consumer's typecheck with "';' expected" — the Vite/SFC
    // compiler doesn't care, so this only ever showed up as a broken `vue-tsc` run
    // in a real project, not in this repo's own build.
    const icon = { id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' }
    registerUseComponent(icon)

    const call = vi.mocked(addTemplate).mock.calls.at(-1)![0] as { getContents: () => string }
    const content = call.getContents()

    expect(content).toMatch(/<\/template>\r?\n<script setup/)
    expect(content).not.toMatch(/<\/template><script setup/)
  })

  it('registers the component under the icon\'s componentName, pointing at the generated template', () => {
    const icon = { id: 'admin-star', componentName: 'UseAdminStar', absolutePath: '/icons/admin/star.svg' }
    registerUseComponent(icon)

    expect(vi.mocked(addComponent)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'UseAdminStar' }),
    )
  })

  it('the generated component references the icon id in its <use> href', () => {
    const icon = { id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' }
    registerUseComponent(icon)

    const call = vi.mocked(addTemplate).mock.calls.at(-1)![0] as { getContents: () => string }
    expect(call.getContents()).toContain('href="#home"')
  })
})
