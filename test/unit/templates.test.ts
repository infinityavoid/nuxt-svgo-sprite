import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { addTemplate, addTypeTemplate, addComponentExports } from '@nuxt/kit'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  buildIconTypesContent,
  buildUseComponentsFileContent,
  writeUseComponentsFileSync,
  setupTemplates,
} from '../../src/templates/templates'
import type { SpriteCollection } from '../../src/types/types'

const FAKE_BUILD_DIR = path.resolve('/build')

// A single shared fake nuxt instance (not a fresh object per useNuxt() call) so tests
// can trigger hooks registered on it — e.g. the components:dirs rewrite listener
// setupTemplates registers via nuxt.hook(...).
const hookHandlers = new Map<string, (() => void)[]>()
const fakeNuxt = {
  options: { buildDir: FAKE_BUILD_DIR },
  hook: vi.fn((event: string, handler: () => void) => {
    const list = hookHandlers.get(event) ?? []
    list.push(handler)
    hookHandlers.set(event, list)
  }),
}
function triggerHook(event: string): void {
  for (const handler of hookHandlers.get(event) ?? []) handler()
}

vi.mock('@nuxt/kit', () => ({
  addTemplate: vi.fn((opts: { filename: string, getContents: () => string }) => ({ dst: `/build/${opts.filename}` })),
  addTypeTemplate: vi.fn((opts: { filename: string, getContents: () => string }) => ({ dst: `/build/${opts.filename}` })),
  addComponent: vi.fn(),
  addComponentExports: vi.fn(),
  useNuxt: vi.fn(() => fakeNuxt),
}))

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
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

describe('buildUseComponentsFileContent', () => {
  it('generates one named export per icon, across every collection', () => {
    const defaultCol = makeCol('default', 'DefaultIconName', ['home'])
    const adminCol = makeCol('admin', 'AdminIconName', ['admin-star'])
    const content = buildUseComponentsFileContent([defaultCol, adminCol])
    expect(content).toContain(`export const ${defaultCol.icons[0]!.componentName}`)
    expect(content).toContain(`export const ${adminCol.icons[0]!.componentName}`)
  })

  it('references the icon id in its <use> href', () => {
    const content = buildUseComponentsFileContent([makeCol('default', 'DefaultIconName', ['home'])])
    expect(content).toContain('href: "#home"')
  })

  it('sets inheritAttrs: false, matching the old per-icon SFC behavior', () => {
    const content = buildUseComponentsFileContent([makeCol('default', 'DefaultIconName', ['home'])])
    expect(content).toContain('inheritAttrs: false')
  })

  it('imports h and defineComponent from vue', () => {
    const content = buildUseComponentsFileContent([makeCol('default', 'DefaultIconName', ['home'])])
    expect(content).toContain('import { h, defineComponent } from \'vue\'')
  })

  it('produces valid, parseable JavaScript (each export statement individually parses)', () => {
    // Icon ids are already sanitized to [a-z0-9-] by construction (collection-builder.ts),
    // but the id/componentName are interpolated as JSON.stringify'd string literals /
    // identifiers here rather than raw template-literal interpolation, so a value that
    // needed escaping couldn't break out of the string. `new Function` can't parse
    // `export` (module syntax, not valid in a plain function body) — strip it and
    // check the REST parses instead, proving the interpolated values didn't break
    // the surrounding JS syntax.
    const content = buildUseComponentsFileContent([makeCol('default', 'DefaultIconName', ['home'])])
    const body = content.replace(/^import.*\n/, '').replace(/^export const (\w+) =/gm, 'const $1 =')
    expect(() => new Function(body)).not.toThrow(SyntaxError)
  })

  it('produces no exports for an empty collection list', () => {
    const content = buildUseComponentsFileContent([])
    expect(content).not.toContain('export const')
  })
})

describe('writeUseComponentsFileSync', () => {
  it('creates the parent directory and writes the generated content', () => {
    vi.mocked(mkdirSync).mockClear()
    vi.mocked(writeFileSync).mockClear()

    const filePath = path.join(FAKE_BUILD_DIR, 'nuxt-svgo-sprite', 'use-components.ts')
    writeUseComponentsFileSync(filePath, [makeCol('default', 'DefaultIconName', ['home'])])

    expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(path.dirname(filePath), { recursive: true })
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(filePath, expect.stringContaining('export const UseHome'), 'utf-8')
  })
})

describe('setupTemplates', () => {
  it('registers the type declaration via addTypeTemplate, not addTemplate — no manual prepare:types wiring needed', () => {
    // Regression / item #8: addTypeTemplate registers its own prepare:types push
    // internally (unlike addTemplate); a caller that still used addTemplate here
    // would need its own nuxt.hook('prepare:types', ...), which is what this
    // replaced.
    setupTemplates([], {}, new Map(), () => 'export type AllIconName = never\n')

    const typeCall = vi.mocked(addTypeTemplate).mock.calls.at(-1)![0] as { filename: string }
    expect(typeCall.filename).toBe('nuxt-svgo-sprite/icon-names.d.ts')

    // addTemplate is still used for the SvgUse.vue template — just not for the .d.ts.
    const templateFilenames = vi.mocked(addTemplate).mock.calls.map(c => (c[0] as { filename: string }).filename)
    expect(templateFilenames).not.toContain('nuxt-svgo-sprite/icon-names.d.ts')
  })

  it('does nothing with the Use* components file when createUseComponents is false', () => {
    vi.mocked(addComponentExports).mockClear()
    const handles = setupTemplates([makeCol('default', 'DefaultIconName', ['home'])], {}, new Map(), () => '')
    expect(vi.mocked(addComponentExports)).not.toHaveBeenCalled()
    expect(handles.useComponentsFilePath).toBeUndefined()
  })

  it('when createUseComponents is true, writes the shared file synchronously BEFORE registering it via addComponentExports (item #16, ADR-025)', () => {
    // Order matters: addComponentExports's first export-name resolution happens
    // during the same generateApp pass — the file must already exist on disk by
    // the time this function returns, not rely on addTemplate's own later write.
    vi.mocked(addComponentExports).mockClear()
    vi.mocked(writeFileSync).mockClear()
    const writeOrder: string[] = []
    vi.mocked(writeFileSync).mockImplementation(() => {
      writeOrder.push('write')
    })
    vi.mocked(addComponentExports).mockImplementation(() => {
      writeOrder.push('register')
    })

    const handles = setupTemplates(
      [makeCol('default', 'DefaultIconName', ['home'])],
      { createUseComponents: true },
      new Map(),
      () => '',
    )

    expect(writeOrder).toEqual(['write', 'register'])
    expect(vi.mocked(addComponentExports)).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: handles.useComponentsFilePath }),
    )
    expect(handles.useComponentsFilePath).toBe(path.join(FAKE_BUILD_DIR, 'nuxt-svgo-sprite', 'use-components.ts'))
  })

  it('re-writes the file on every components:dirs firing, reading LIVE collections — survives nuxi prepare\'s clearBuildDir()', () => {
    // Regression: `nuxi prepare` calls clearBuildDir(nuxt.options.buildDir) AFTER
    // modules' setup() runs but BEFORE the first generateApp pass — deleting the
    // synchronous write from setupTemplates before addComponentExports's own
    // components:dirs handler ever got to read it. Reproduced directly against a
    // real `nuxt prepare playground` run (and against mlly's resolveModuleExportNames
    // in isolation) before fixing this. The fix: register OUR OWN components:dirs
    // listener BEFORE calling addComponentExports (hookable fires listeners in
    // registration order), so the file is rewritten fresh on every firing —
    // including the very first one, regardless of anything that deleted it since.
    hookHandlers.clear()
    vi.mocked(writeFileSync).mockClear()

    let currentCollections: SpriteCollection[] = [makeCol('default', 'DefaultIconName', ['home'])]
    setupTemplates(
      currentCollections,
      { createUseComponents: true },
      new Map(),
      () => '',
      () => currentCollections,
    )

    expect(vi.mocked(fakeNuxt.hook)).toHaveBeenCalledWith('components:dirs', expect.any(Function))
    vi.mocked(writeFileSync).mockClear()

    // Mutate as a rebuild would, then trigger components:dirs the way Nuxt would on
    // ANY later generateApp pass (not just one we explicitly requested).
    currentCollections = [makeCol('default', 'DefaultIconName', ['home', 'star'])]
    triggerHook('components:dirs')

    expect(vi.mocked(writeFileSync)).toHaveBeenCalledOnce()
    const written = vi.mocked(writeFileSync).mock.calls[0]![1] as string
    expect(written).toContain('export const UseStar')
  })
})
