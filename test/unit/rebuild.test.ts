// vitest hoists vi.mock() calls before imports at runtime; all imports go at the top per ESLint
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SpriteCollection } from '../../src/types/types'
import type { RebuildContext } from '../../src/setup/rebuild'
import { createRebuildHandler } from '../../src/setup/rebuild'
import { rebuildSingleCollection } from '../../src/builders/collection-builder'
import { buildSprite } from '../../src/builders/sprite-builder'
import { writeUseComponentsFileSync } from '../../src/templates/templates'

const USE_COMPONENTS_FILE_PATH = '/build/nuxt-svgo-sprite/use-components.ts'

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
  writeUseComponentsFileSync: vi.fn(),
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
      useComponentsFilePath: undefined,
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
    expect(rebuildSingleCollection).toHaveBeenCalledWith(col, 'Use', mockLogger, undefined)
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

  function useComponentsHandles(base: RebuildContext['handles']) {
    return { ...base, useComponentsFilePath: USE_COMPONENTS_FILE_PATH }
  }

  it('on add with createUseComponents: true, rewrites the shared Use* components file and logs the new component', async () => {
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
    ctx.handles = useComponentsHandles(ctx.handles)
    const handler = createRebuildHandler(ctx)
    await handler(makeCollection('default', '/icons'), 'add', '/icons/home.svg')

    expect(writeUseComponentsFileSync).toHaveBeenCalledOnce()
    expect(writeUseComponentsFileSync).toHaveBeenCalledWith(USE_COMPONENTS_FILE_PATH, ctx.collectionsRef.current)
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Registered new component <UseHome />'))
  })

  it('does not rewrite the file when the icon set is unchanged (a plain content edit)', async () => {
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
    ctx.handles = useComponentsHandles(ctx.handles)
    const handler = createRebuildHandler(ctx)
    await handler(preRebuildCol, 'change', '/icons/home.svg')

    expect(writeUseComponentsFileSync).not.toHaveBeenCalled()
  })

  it('rewrites the file once for several new icons added in one rebuild, not just the one from the triggering event', async () => {
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
    ctx.handles = useComponentsHandles(ctx.handles)
    const handler = createRebuildHandler(ctx)
    // Only iconB's path is passed as absPath — the debounced trailing call's arg —
    // yet iconA must also be reflected in the rewritten file.
    await handler(preRebuildCol, 'add', '/icons/beta.svg')

    expect(writeUseComponentsFileSync).toHaveBeenCalledOnce()
    expect(writeUseComponentsFileSync).toHaveBeenCalledWith(USE_COMPONENTS_FILE_PATH, ctx.collectionsRef.current)
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Registered new component <UseAlpha />'))
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Registered new component <UseBeta />'))
  })

  it('an icon that buildSprite rejects during processing is excluded from the updated collection and from the rewritten file', async () => {
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
    ctx.handles = useComponentsHandles(ctx.handles)
    const handler = createRebuildHandler(ctx)
    await handler(col, 'add', '/icons/bad.svg')

    const updated = ctx.collectionsRef.current.find(c => c.name === 'default')!
    expect(updated.icons).toEqual([goodIcon])
    expect(writeUseComponentsFileSync).toHaveBeenCalledOnce()
    expect(writeUseComponentsFileSync).toHaveBeenCalledWith(USE_COMPONENTS_FILE_PATH, ctx.collectionsRef.current)
  })

  it('on unlink with createUseComponents: true, rewrites the file WITHOUT the removed icon and logs the unregistration — no restart needed (closes ADR-011)', async () => {
    const survivorIcon = { id: 'star', componentName: 'UseStar', absolutePath: '/icons/star.svg' }
    const removedIcon = { id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' }
    const preRebuildCol = makeCollection('default', '/icons', [survivorIcon, removedIcon])
    const updatedCol = makeCollection('default', '/icons', [survivorIcon]);
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
    ctx.handles = useComponentsHandles(ctx.handles)
    const handler = createRebuildHandler(ctx)
    await handler(preRebuildCol, 'unlink', '/icons/home.svg')

    expect(writeUseComponentsFileSync).toHaveBeenCalledOnce()
    // The rewritten file must reflect the collection WITHOUT the removed icon.
    const [, collectionsPassed] = (writeUseComponentsFileSync as ReturnType<typeof vi.fn>).mock.calls[0]!
    const defaultCollectionPassed = (collectionsPassed as SpriteCollection[]).find(c => c.name === 'default')!
    expect(defaultCollectionPassed.icons.map(i => i.id)).toEqual(['star'])
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Unregistered component <UseHome />'))
  })

  it('does nothing to the Use* components file when createUseComponents is false', async () => {
    const updatedCol = makeCollection('default', '/icons', []);
    (rebuildSingleCollection as ReturnType<typeof vi.fn>).mockResolvedValue(updatedCol)

    const ctx = makeCtx() // createUseComponents: false by default, useComponentsFilePath: undefined
    const handler = createRebuildHandler(ctx)
    await handler(makeCollection('default', '/icons', [{ id: 'home', componentName: 'UseHome', absolutePath: '/icons/home.svg' }]), 'unlink', '/icons/home.svg')

    expect(writeUseComponentsFileSync).not.toHaveBeenCalled()
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
      ctx.options.colorOptions,
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
      ctx.options.colorOptions,
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
