// vitest hoists vi.mock() calls before imports at runtime; all imports go at the top per ESLint
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SpriteCollection } from '../../src/types/types'
import type { RebuildContext } from '../../src/setup/rebuild'
import { createRebuildHandler } from '../../src/setup/rebuild'
import { rebuildSingleCollection } from '../../src/builders/collection-builder'
import { buildSprite } from '../../src/builders/sprite-builder'
import { registerUseComponent } from '../../src/templates/templates'

vi.mock('@nuxt/kit', () => ({
  updateTemplates: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/builders/collection-builder', () => ({
  rebuildSingleCollection: vi.fn(),
}))

vi.mock('../../src/builders/sprite-builder', () => ({
  buildSprite: vi.fn().mockResolvedValue('<svg><symbol id="home"/></svg>'),
}))

vi.mock('../../src/templates/templates', () => ({
  buildIconTypesContent: vi.fn().mockReturnValue('export type DefaultIconName = "home"'),
  registerUseComponent: vi.fn(),
}))

function makeCollection(name: string, inputDir: string, icons: SpriteCollection['icons'] = []): SpriteCollection {
  return {
    name,
    segments: name === 'default' ? [] : [name],
    inputDir,
    spriteComponentName: `${name.charAt(0).toUpperCase() + name.slice(1)}Sprite`,
    typeName: `${name.charAt(0).toUpperCase() + name.slice(1)}IconName`,
    icons,
  }
}

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
})

function makeCtx(overrides: Partial<RebuildContext> = {}): RebuildContext {
  const defaultCol = makeCollection('default', '/icons')
  const adminCol = makeCollection('admin', '/icons/admin')

  return {
    options: {
      componentPrefix: 'Use',
      svgoConfig: {},
      optimizeFiles: true,
      createUseComponents: false,
    },
    collectionsRef: { current: [defaultCol, adminCol] },
    spriteContents: new Map([['default', '<svg/>'], ['admin', '<svg/>']]),
    iconTypesRef: { current: '' },
    handles: {
      spriteTemplateNames: new Map([
        ['default', 'nuxt-svgo-sprite/DefaultSprite.vue'],
        ['admin', 'nuxt-svgo-sprite/AdminSprite.vue'],
      ]),
      typeTemplateName: 'nuxt-svgo-sprite/icon-names.d.ts',
    },
    injectTemplateName: undefined,
    injectedCollectionNames: new Set(),
    logger: mockLogger,
    ...overrides,
  }
}

describe('createRebuildHandler', () => {
  it('calls rebuildSingleCollection with the changed collection', async () => {
    const col = makeCollection('default', '/icons')
    const updatedCol = makeCollection('default', '/icons', [
      { id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' },
    ]);
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol)

    const ctx = makeCtx()
    const handler = createRebuildHandler(ctx)
    await handler(col, 'change', '/icons/home.svg')

    expect(rebuildSingleCollection).toHaveBeenCalledOnce()
    expect(rebuildSingleCollection).toHaveBeenCalledWith(col, 'Use', mockLogger)
  })

  it('updates collectionsRef with the rebuilt collection but leaves other collections intact', async () => {
    const col = makeCollection('default', '/icons')
    const updatedCol = makeCollection('default', '/icons', [
      { id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' },
    ]);
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol)

    const ctx = makeCtx()
    const handler = createRebuildHandler(ctx)
    await handler(col, 'change', '/icons/home.svg')

    const names = ctx.collectionsRef.current.map(c => c.name)
    expect(names).toContain('default')
    expect(names).toContain('admin')
    const updated = ctx.collectionsRef.current.find(c => c.name === 'default')!
    expect(updated.icons).toHaveLength(1)
    expect(updated.icons[0]!.id).toBe('home')
    const admin = ctx.collectionsRef.current.find(c => c.name === 'admin')!
    expect(admin.icons).toHaveLength(0)
  })

  it('rebuilds only the changed collection sprite, not others', async () => {
    const col = makeCollection('admin', '/icons/admin')
    const updatedCol = makeCollection('admin', '/icons/admin', [
      { id: 'admin-star', componentName: 'UseAdminStar', absolutePath: '/icons/admin/star.svg' },
    ]);
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol)

    const ctx = makeCtx()
    const handler = createRebuildHandler(ctx)
    await handler(col, 'change', '/icons/admin/star.svg')

    expect(buildSprite).toHaveBeenCalledOnce()
    expect(ctx.spriteContents.get('admin')).toBe('<svg><symbol id="home"/></svg>')
    expect(ctx.spriteContents.get('default')).toBe('<svg/>')
  })

  it('on add with createUseComponents: true, registers the new Use component', async () => {
    const newIcon = { id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' }
    const updatedCol = makeCollection('default', '/icons', [newIcon]);
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol)

    const ctx = makeCtx({
      options: {
        componentPrefix: 'Use',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svgoConfig: {} as any,
        optimizeFiles: true,
        createUseComponents: true,
      },
    })
    const handler = createRebuildHandler(ctx)
    await handler(makeCollection('default', '/icons'), 'add', '/icons/home.svg')

    expect(registerUseComponent).toHaveBeenCalledOnce()
    expect(registerUseComponent).toHaveBeenCalledWith(newIcon)
  })

  it('on change, does not register Use component even with createUseComponents: true', async () => {
    const updatedCol = makeCollection('default', '/icons', [
      { id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' },
    ]);
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol)

    const ctx = makeCtx({
      options: {
        componentPrefix: 'Use',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svgoConfig: {} as any,
        optimizeFiles: true,
        createUseComponents: true,
      },
    })
    const handler = createRebuildHandler(ctx)
    await handler(makeCollection('default', '/icons'), 'change', '/icons/home.svg')

    expect(registerUseComponent).not.toHaveBeenCalled()
  })

  it('calls broadcastRefresh when provided', async () => {
    const col = makeCollection('default', '/icons')
    const updatedCol = makeCollection('default', '/icons');
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol)

    const broadcastRefresh = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({ broadcastRefresh })
    const handler = createRebuildHandler(ctx)
    await handler(col, 'change', '/icons/home.svg')

    expect(broadcastRefresh).toHaveBeenCalledOnce()
  })
})
