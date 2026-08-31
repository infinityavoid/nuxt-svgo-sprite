import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  projectCollections,
  resolveIconPreviewPath,
  resolveDevtoolsRoute,
  createDevtoolsMiddleware,
  setupDevtools,
} from '../../src/devtools/devtools'
import type { SpriteCollection } from '../../src/types/types'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Nuxt } from '@nuxt/schema'
import { addCustomTab } from '@nuxt/devtools-kit'

vi.mock('@nuxt/devtools-kit', () => ({
  addCustomTab: vi.fn(),
  extendServerRpc: vi.fn(),
  onDevToolsInitialized: vi.fn(),
}))

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
  it('projects each collection to a DTO with correct shape (createUseComponents: true)', () => {
    const result = projectCollections(collections, new Set(['default']), true)
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

  it('omits componentName entirely when createUseComponents is false — no such component exists', () => {
    const result = projectCollections(collections, new Set(['default']), false)
    for (const col of result) {
      for (const icon of col.icons) {
        expect(icon).not.toHaveProperty('componentName')
      }
    }
    expect(result[0]!.icons[0]).toEqual({ id: 'home' })
  })

  it('marks injected correctly based on the set', () => {
    const result = projectCollections(collections, new Set(['admin']), true)
    expect(result.find(c => c.name === 'admin')!.injected).toBe(true)
    expect(result.find(c => c.name === 'default')!.injected).toBe(false)
  })

  it('returns empty array for empty collections', () => {
    expect(projectCollections([], new Set(), true)).toEqual([])
  })

  it('does not include absolutePath in the DTO', () => {
    const result = projectCollections(collections, new Set(), true)
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

// ─── createDevtoolsMiddleware ─────────────────────────────────────────────────

describe('createDevtoolsMiddleware', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'svgo-sprite-devtools-mw-test-'))
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  function makeReqRes(url: string) {
    const headers: Record<string, string> = {}
    const req = { url } as IncomingMessage
    const res = {
      statusCode: 200,
      setHeader: vi.fn((name: string, value: string) => { headers[name] = value }),
      end: vi.fn(),
    } as unknown as ServerResponse & { end: ReturnType<typeof vi.fn> }
    return { req, res, headers }
  }

  async function flush() {
    await new Promise(r => setTimeout(r, 50))
  }

  it('serves the client HTML shell at "/"', async () => {
    const { req, res, headers } = makeReqRes('/')
    createDevtoolsMiddleware({ current: [] })(req, res)
    await flush()
    expect(headers['Content-Type']).toContain('text/html')
    expect(res.end.mock.calls[0]?.[0]).toContain('<!DOCTYPE html>')
  })

  it('serves the client HTML shell at "" (empty url)', async () => {
    const { req, res, headers } = makeReqRes('')
    createDevtoolsMiddleware({ current: [] })(req, res)
    await flush()
    expect(headers['Content-Type']).toContain('text/html')
  })

  it('serves a known icon\'s raw SVG content with no-cache', async () => {
    const filePath = path.join(tmpDir, 'home.svg')
    await fsp.writeFile(filePath, '<svg viewBox="0 0 24 24"></svg>', 'utf-8')
    const collections: SpriteCollection[] = [{
      name: 'default',
      segments: [],
      inputDir: tmpDir,
      spriteComponentName: 'DefaultSprite',
      typeName: 'DefaultIconName',
      icons: [{ id: 'home', componentName: 'UseHome', absolutePath: filePath }],
    }]
    const { req, res, headers } = makeReqRes('/svg/default/home')
    createDevtoolsMiddleware({ current: collections })(req, res)
    await flush()
    expect(headers['Content-Type']).toContain('image/svg+xml')
    expect(headers['Cache-Control']).toBe('no-cache')
    expect(res.end.mock.calls[0]?.[0]).toContain('<svg')
  })

  it('ignores a query string when matching the /svg/ route', async () => {
    const filePath = path.join(tmpDir, 'home.svg')
    await fsp.writeFile(filePath, '<svg viewBox="0 0 24 24"></svg>', 'utf-8')
    const collections: SpriteCollection[] = [{
      name: 'default',
      segments: [],
      inputDir: tmpDir,
      spriteComponentName: 'DefaultSprite',
      typeName: 'DefaultIconName',
      icons: [{ id: 'home', componentName: 'UseHome', absolutePath: filePath }],
    }]
    const { req, res } = makeReqRes('/svg/default/home?cachebust=123')
    createDevtoolsMiddleware({ current: collections })(req, res)
    await flush()
    expect(res.end.mock.calls[0]?.[0]).toContain('<svg')
  })

  it('returns 404 for an unknown icon id', async () => {
    const { req, res } = makeReqRes('/svg/default/nonexistent')
    createDevtoolsMiddleware({ current: [] })(req, res)
    await flush()
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 for a completely unknown route', () => {
    const { req, res } = makeReqRes('/not-a-real-route')
    createDevtoolsMiddleware({ current: [] })(req, res)
    expect(res.statusCode).toBe(404)
  })
})

// ─── setupDevtools: vite:serverCreated registration ────────────────────────────

describe('setupDevtools', () => {
  it('registers the preview middleware only on the client Vite server, not the SSR one', () => {
    const handlers: ((viteServer: unknown, env: { isClient: boolean, isServer: boolean }) => void)[] = []
    const fakeNuxt = {
      options: { app: { baseURL: '/' } },
      hook: vi.fn((event: string, handler: typeof handlers[number]) => {
        if (event === 'vite:serverCreated') handlers.push(handler)
      }),
    } as unknown as Nuxt

    setupDevtools(fakeNuxt, { current: [] }, new Set(), false)

    expect(handlers).toHaveLength(1)
    const use = vi.fn()
    const viteServer = { middlewares: { use } }

    // SSR server first (as Nuxt fires it) — must be a no-op.
    handlers[0]!(viteServer, { isClient: false, isServer: true })
    expect(use).not.toHaveBeenCalled()

    // Client server — middleware must be registered exactly once.
    handlers[0]!(viteServer, { isClient: true, isServer: false })
    expect(use).toHaveBeenCalledOnce()
    expect(use).toHaveBeenCalledWith('/__nuxt-svgo-sprite', expect.any(Function))
  })

  it('joins app.baseURL into both the middleware mount path and the DevTools tab src (item #17)', () => {
    // Regression: these two (plus the client's own preview-image URLs, covered
    // separately below) used to be hardcoded to "/__nuxt-svgo-sprite" — fixing only
    // one under a non-root baseURL would have broken the others.
    const handlers: ((viteServer: unknown, env: { isClient: boolean, isServer: boolean }) => void)[] = []
    const fakeNuxt = {
      options: { app: { baseURL: '/my-app/' } },
      hook: vi.fn((event: string, handler: typeof handlers[number]) => {
        if (event === 'vite:serverCreated') handlers.push(handler)
      }),
    } as unknown as Nuxt

    setupDevtools(fakeNuxt, { current: [] }, new Set(), false)

    expect(vi.mocked(addCustomTab)).toHaveBeenCalledWith(
      expect.objectContaining({ view: { type: 'iframe', src: '/my-app/__nuxt-svgo-sprite' } }),
    )

    const use = vi.fn()
    handlers[0]!({ middlewares: { use } }, { isClient: true, isServer: false })
    expect(use).toHaveBeenCalledWith('/my-app/__nuxt-svgo-sprite', expect.any(Function))
  })
})

// ─── resolveDevtoolsRoute ─────────────────────────────────────────────────────

describe('resolveDevtoolsRoute', () => {
  function fakeNuxt(baseURL: string): Nuxt {
    return { options: { app: { baseURL } } } as unknown as Nuxt
  }

  it('joins a root baseURL without a double slash', () => {
    expect(resolveDevtoolsRoute(fakeNuxt('/'), '/__nuxt-svgo-sprite')).toBe('/__nuxt-svgo-sprite')
  })

  it('joins a non-root baseURL', () => {
    expect(resolveDevtoolsRoute(fakeNuxt('/my-app'), '/__nuxt-svgo-sprite')).toBe('/my-app/__nuxt-svgo-sprite')
  })

  it('joins a non-root baseURL with a trailing slash, without a double slash', () => {
    expect(resolveDevtoolsRoute(fakeNuxt('/my-app/'), '/__nuxt-svgo-sprite')).toBe('/my-app/__nuxt-svgo-sprite')
  })

  it('falls back to "/" when baseURL is empty', () => {
    expect(resolveDevtoolsRoute(fakeNuxt(''), '/__nuxt-svgo-sprite')).toBe('/__nuxt-svgo-sprite')
  })
})

// ─── createDevtoolsMiddleware: routePath embedded into clientHtml ────────────────

describe('createDevtoolsMiddleware — routePath', () => {
  it('embeds a non-default routePath into the client shell, for the preview-image URLs', async () => {
    const { req, res } = (() => {
      const headers: Record<string, string> = {}
      const req = { url: '/' } as IncomingMessage
      const res = {
        statusCode: 200,
        setHeader: vi.fn((name: string, value: string) => { headers[name] = value }),
        end: vi.fn(),
      } as unknown as ServerResponse & { end: ReturnType<typeof vi.fn> }
      return { req, res }
    })()

    createDevtoolsMiddleware({ current: [] }, '/my-app/__nuxt-svgo-sprite')(req, res)
    await new Promise(r => setTimeout(r, 50))

    const html = res.end.mock.calls[0]?.[0] as string
    expect(html).toContain('"/my-app/__nuxt-svgo-sprite"')
  })

  it('defaults to "/__nuxt-svgo-sprite" when routePath is omitted', async () => {
    const req = { url: '/' } as IncomingMessage
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse & { end: ReturnType<typeof vi.fn> }

    createDevtoolsMiddleware({ current: [] })(req, res)
    await new Promise(r => setTimeout(r, 50))

    const html = res.end.mock.calls[0]?.[0] as string
    expect(html).toContain('"/__nuxt-svgo-sprite"')
  })
})
