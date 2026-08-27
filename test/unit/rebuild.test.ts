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
  // Simulates every passed-in icon succeeding, by default — matches prior tests'
  // implicit assumption. Tests that need a partial failure call onIconResult
  // themselves via a one-off mockImplementationOnce.
  buildSprite: vi.fn((icons: { absolutePath: string }[], _svgoConfig: unknown, _optimizeFiles: boolean, _logger: unknown, _spriteName: string, onIconResult?: (icon: unknown, included: boolean) => void) => {
    for (const icon of icons) onIconResult?.(icon, true)
    return Promise.resolve('<svg><symbol id="home"/></svg>')
  }),
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

  it('does not register a Use component for an icon that already existed before this rebuild', async () => {
    const existingIcon = { id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' }
    const preRebuildCol = makeCollection('default', '/icons', [existingIcon])
    const updatedCol = makeCollection('default', '/icons', [existingIcon]);
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
    await handler(preRebuildCol, 'change', '/icons/home.svg')

    expect(registerUseComponent).not.toHaveBeenCalled()
  })

  it('registers a Use component for every new icon in one rebuild, not just the one from the triggering event', async () => {
    // Simulates several files being added at once, coalesced by the watcher's
    // debounce into a single rebuild firing with only the last event's absPath.
    const preRebuildCol = makeCollection('default', '/icons')
    const iconA = { id: 'alpha', componentName: 'UseAlpha', absolutePath: '/icons/alpha.svg' }
    const iconB = { id: 'beta', componentName: 'UseBeta', absolutePath: '/icons/beta.svg' }
    const updatedCol = makeCollection('default', '/icons', [iconA, iconB]);
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
    // Only iconB's path is passed as absPath — the debounced trailing call's arg —
    // yet iconA must also get registered.
    await handler(preRebuildCol, 'add', '/icons/beta.svg')

    expect(registerUseComponent).toHaveBeenCalledTimes(2)
    expect(registerUseComponent).toHaveBeenCalledWith(iconA)
    expect(registerUseComponent).toHaveBeenCalledWith(iconB)
  })

  it('an icon that buildSprite rejects during processing is excluded from the updated collection and never registered as a Use component', async () => {
    const col = makeCollection('default', '/icons')
    const goodIcon = { id: 'good', componentName: 'UseGood', absolutePath: '/icons/good.svg' }
    const badIcon = { id: 'bad', componentName: 'UseBad', absolutePath: '/icons/bad.svg' }
    const updatedCol = makeCollection('default', '/icons', [goodIcon, badIcon]);
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol);
    // Override the shared "everything succeeds" mock for this one call: `bad` fails.
    (buildSprite as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (icons: { id: string }[], _c: unknown, _o: boolean, _l: unknown, _s: string, onIconResult?: (icon: unknown, included: boolean) => void) => {
        for (const icon of icons) onIconResult?.(icon, icon.id !== 'bad')
        return Promise.resolve('<svg><symbol id="good"/></svg>')
      },
    )

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
    await handler(col, 'add', '/icons/bad.svg')

    const updated = ctx.collectionsRef.current.find(c => c.name === 'default')!
    expect(updated.icons).toEqual([goodIcon])
    expect(registerUseComponent).toHaveBeenCalledOnce()
    expect(registerUseComponent).toHaveBeenCalledWith(goodIcon)
  })

  it('passes ctx.symbolCache through to buildSprite so unchanged icons can be skipped on rescan', async () => {
    const col = makeCollection('default', '/icons')
    const updatedCol = makeCollection('default', '/icons');
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol)

    const symbolCache = new Map()
    const ctx = makeCtx({ symbolCache })
    const handler = createRebuildHandler(ctx)
    await handler(col, 'change', '/icons/home.svg')

    expect(buildSprite).toHaveBeenCalledWith(
      updatedCol.icons,
      ctx.options.svgoConfig,
      ctx.options.optimizeFiles,
      mockLogger,
      'default',
      expect.any(Function),
      symbolCache,
    )
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

  it('passes the collection name as spriteName to buildSprite, not the "default" fallback', async () => {
    const col = makeCollection('admin', '/icons/admin')
    const updatedCol = makeCollection('admin', '/icons/admin', [
      { id: 'admin-star', componentName: 'UseAdminStar', absolutePath: '/icons/admin/star.svg' },
    ]);
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol)

    const ctx = makeCtx()
    const handler = createRebuildHandler(ctx)
    await handler(col, 'change', '/icons/admin/star.svg')

    expect(buildSprite).toHaveBeenCalledWith(
      updatedCol.icons,
      ctx.options.svgoConfig,
      ctx.options.optimizeFiles,
      mockLogger,
      'admin',
      expect.any(Function),
      undefined,
    )
  })

  it('drops a rescanned icon whose id collides with another live collection, and warns', async () => {
    const col = makeCollection('admin', '/icons/admin')
    const updatedCol = makeCollection('admin', '/icons/admin', [
      { id: 'home', componentName: 'UseHome', absolutePath: '/icons/admin/home.svg' },
    ]);
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol)

    const defaultCol = makeCollection('default', '/icons', [
      { id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' },
    ])
    const ctx = makeCtx({ collectionsRef: { current: [defaultCol, makeCollection('admin', '/icons/admin')] } })
    const handler = createRebuildHandler(ctx)
    await handler(col, 'change', '/icons/admin/home.svg')

    const admin = ctx.collectionsRef.current.find(c => c.name === 'admin')!
    expect(admin.icons).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Symbol id collision'))
  })

  it('logs an error and does not throw when rebuildSingleCollection rejects', async () => {
    const col = makeCollection('default', '/icons');
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('EBUSY: resource busy'))

    const ctx = makeCtx()
    const handler = createRebuildHandler(ctx)
    await expect(handler(col, 'change', '/icons/home.svg')).resolves.toBeUndefined()

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('EBUSY'))
    // State is left untouched on failure.
    expect(ctx.collectionsRef.current).toEqual([
      makeCollection('default', '/icons'),
      makeCollection('admin', '/icons/admin'),
    ])
  })
})
