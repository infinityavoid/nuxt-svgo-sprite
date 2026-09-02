import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { scanUsedIconIds } from '../../src/builders/usage-scanner'
import type { SpriteCollection } from '../../src/types/types'

const EXTENSIONS = ['.vue', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'svgo-sprite-scanner-test-'))
})

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

async function writeSrc(relPath: string, content: string) {
  const filePath = path.join(tmpDir, relPath)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf-8')
}

function makeCollection(icons: { id: string, componentName: string }[]): SpriteCollection {
  return {
    name: 'default',
    segments: [],
    inputDir: '/icons',
    sources: [{ dir: '/icons', label: '(root)' }],
    spriteComponentName: 'DefaultSprite',
    typeName: 'DefaultIconName',
    icons: icons.map(i => ({ ...i, absolutePath: `/icons/${i.id}.svg` })),
  }
}

describe('scanUsedIconIds', () => {
  it('detects an icon id used as a quoted string (<SvgUse name="home">)', async () => {
    await writeSrc('app.vue', '<template><SvgUse name="home" /></template>')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(true)
  })

  it('detects an icon id used with single quotes', async () => {
    await writeSrc('app.vue', '<script setup>const n = \'home\'</script>')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(true)
  })

  it('detects an icon via its componentName used as a template tag (<UseHome />)', async () => {
    await writeSrc('app.vue', '<template><UseHome /></template>')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(true)
  })

  it('detects an icon via its componentName used as a bare identifier (resolveComponent call)', async () => {
    await writeSrc('app.ts', 'resolveComponent(\'UseHome\')')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(true)
  })

  it('does not detect an icon with no matching literal anywhere in source', async () => {
    await writeSrc('app.vue', '<template><SvgUse name="star" /></template>')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(false)
  })

  it('does not false-positive on a substring match — "home" must be a whole quoted string, not embedded in a longer one', async () => {
    await writeSrc('app.vue', '<template><SvgUse name="homepage-icon" /></template>')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(false)
  })

  it('ignores files whose extension is not in the scan list (e.g. .svg, .md)', async () => {
    await writeSrc('notes.md', '"home"')
    await writeSrc('icons/home.svg', '<svg name="home"></svg>')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(false)
  })

  it('ignores node_modules', async () => {
    await writeSrc('node_modules/some-pkg/index.js', '"home"')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(false)
  })

  it('excludes files under excludeDirs (e.g. Nuxt buildDir) — critical: our OWN generated use-components.ts must not make every icon look "used"', async () => {
    // A DOT-prefixed buildDir (the real-world ".nuxt") is already excluded by
    // tinyglobby's own default dot:false, independent of excludeDirs — so this alone
    // wouldn't prove the excludeDirs filter itself does anything (see the next test,
    // which uses a non-dot dir specifically to isolate that).
    const buildDir = path.join(tmpDir, '.nuxt')
    await writeSrc('.nuxt/nuxt-svgo-sprite/use-components.ts', 'export const UseHome = defineComponent({})')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [buildDir],
    )
    expect(used.has('home')).toBe(false)
  })

  it('excludeDirs filter itself works, independent of dot-file globbing — non-dot buildDir', async () => {
    const buildDir = path.join(tmpDir, 'build-output')
    await writeSrc('build-output/nuxt-svgo-sprite/use-components.ts', 'export const UseHome = defineComponent({})')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [buildDir],
    )
    expect(used.has('home')).toBe(false)
  })

  it('excludeDirs matches even when the caller passes forward-slash separators (e.g. a pathe-resolved buildDir) against a native-separator platform', async () => {
    const buildDir = path.join(tmpDir, 'build-output')
    await writeSrc('build-output/nuxt-svgo-sprite/use-components.ts', 'export const UseHome = defineComponent({})')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [buildDir.replace(/\\/g, '/')],
    )
    expect(used.has('home')).toBe(false)
  })

  it('detects multiple distinct icons independently', async () => {
    await writeSrc('app.vue', '<template><SvgUse name="home" /><UseStar /></template>')
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([
        { id: 'home', componentName: 'UseHome' },
        { id: 'star', componentName: 'UseStar' },
        { id: 'close', componentName: 'UseClose' },
      ])],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(true)
    expect(used.has('star')).toBe(true)
    expect(used.has('close')).toBe(false)
  })

  it('scans across multiple collections', async () => {
    await writeSrc('app.vue', '<template><SvgUse name="admin-star" /></template>')
    const used = await scanUsedIconIds(
      tmpDir,
      [
        makeCollection([{ id: 'home', componentName: 'UseHome' }]),
        { ...makeCollection([{ id: 'admin-star', componentName: 'UseAdminStar' }]), name: 'admin' },
      ],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(false)
    expect(used.has('admin-star')).toBe(true)
  })

  it('returns an empty set immediately when there are no icons, without scanning', async () => {
    await writeSrc('app.vue', '<template><SvgUse name="home" /></template>')
    const used = await scanUsedIconIds(tmpDir, [makeCollection([])], EXTENSIONS, [])
    expect(used.size).toBe(0)
  })

  it('accepts multiple roots and unions usages found across them (layer roots)', async () => {
    const appRoot = path.join(tmpDir, 'app')
    const layerRoot = path.join(tmpDir, 'layer')
    await fsp.mkdir(path.join(appRoot, 'sub'), { recursive: true })
    await fsp.mkdir(layerRoot, { recursive: true })
    await fsp.writeFile(path.join(appRoot, 'app.vue'), '<template><SvgUse name="home" /></template>', 'utf-8')
    await fsp.writeFile(path.join(layerRoot, 'banner.vue'), '<template><SvgUse name="bell" /></template>', 'utf-8')

    const used = await scanUsedIconIds(
      [appRoot, layerRoot],
      [makeCollection([
        { id: 'home', componentName: 'UseHome' },
        { id: 'bell', componentName: 'UseBell' },
        { id: 'unused', componentName: 'UseUnused' },
      ])],
      EXTENSIONS,
      [],
    )
    expect(used.has('home')).toBe(true)
    expect(used.has('bell')).toBe(true)
    expect(used.has('unused')).toBe(false)
  })

  it('does not double-count a file reachable from two overlapping roots', async () => {
    const outer = tmpDir
    const inner = path.join(tmpDir, 'app')
    await writeSrc('app/app.vue', '<template><SvgUse name="home" /></template>')

    const logger = { info: vi.fn(), warn: vi.fn() }
    await scanUsedIconIds(
      [outer, inner],
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [],
      logger,
    )
    // Exactly one file should be counted, not two, despite `inner` being reachable
    // from both `outer`'s own glob and `inner`'s own glob.
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('1 source file'))
  })

  it('logs a summary via the optional logger', async () => {
    await writeSrc('app.vue', '<template><SvgUse name="home" /></template>')
    const logger = { info: vi.fn(), warn: vi.fn() }
    await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }, { id: 'star', componentName: 'UseStar' }])],
      EXTENSIONS,
      [],
      logger,
    )
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('1/2'))
  })
})

// ─── kebab-case component tags ──────────────────────────────────────────────────

describe('scanUsedIconIds — kebab-case detection', () => {
  it('detects an icon via its kebab-case auto-import tag (<use-home />)', async () => {
    await writeSrc('app.vue', '<template><use-home /></template>')
    const used = await scanUsedIconIds(tmpDir, [makeCollection([{ id: 'home', componentName: 'UseHome' }])], EXTENSIONS, [])
    expect(used.has('home')).toBe(true)
  })

  it('detects the closing-tag form (<use-home></use-home>)', async () => {
    await writeSrc('app.vue', '<template><use-home></use-home></template>')
    const used = await scanUsedIconIds(tmpDir, [makeCollection([{ id: 'home', componentName: 'UseHome' }])], EXTENSIONS, [])
    expect(used.has('home')).toBe(true)
  })

  it('detects a quoted kebab name (resolveComponent(\'use-home\'))', async () => {
    await writeSrc('app.ts', 'resolveComponent(\'use-home\')')
    const used = await scanUsedIconIds(tmpDir, [makeCollection([{ id: 'home', componentName: 'UseHome' }])], EXTENSIONS, [])
    expect(used.has('home')).toBe(true)
  })

  it('multi-segment collection: <use-admin-star /> resolves to id "admin-star"', async () => {
    await writeSrc('app.vue', '<template><use-admin-star /></template>')
    const used = await scanUsedIconIds(tmpDir, [makeCollection([{ id: 'admin-star', componentName: 'UseAdminStar' }])], EXTENSIONS, [])
    expect(used.has('admin-star')).toBe(true)
  })

  it('honours a custom componentPrefix: <icon-home /> resolves to id "home"', async () => {
    await writeSrc('app.vue', '<template><icon-home /></template>')
    const used = await scanUsedIconIds(tmpDir, [makeCollection([{ id: 'home', componentName: 'IconHome' }])], EXTENSIONS, [])
    expect(used.has('home')).toBe(true)
  })

  it('does NOT match a bare kebab word in prose/comments — must be delimited by a tag or a quote', async () => {
    await writeSrc('app.ts', '// the use-home component was renamed')
    const used = await scanUsedIconIds(tmpDir, [makeCollection([{ id: 'home', componentName: 'UseHome' }])], EXTENSIONS, [])
    expect(used.has('home')).toBe(false)
  })

  it('does NOT match a longer hyphenated token (class="use-home-wrapper")', async () => {
    await writeSrc('app.vue', '<template><div class="use-home-wrapper" /></template>')
    const used = await scanUsedIconIds(tmpDir, [makeCollection([{ id: 'home', componentName: 'UseHome' }])], EXTENSIONS, [])
    expect(used.has('home')).toBe(false)
  })

  it('detects Nuxt\'s Lazy/lazy- hydration variants (<LazyUseHome /> and <lazy-use-home />)', async () => {
    await writeSrc('a.vue', '<template><LazyUseHome /></template>')
    await writeSrc('b.vue', '<template><lazy-use-home /></template>')
    const used = await scanUsedIconIds(tmpDir, [makeCollection([{ id: 'home', componentName: 'UseHome' }])], EXTENSIONS, [])
    expect(used.has('home')).toBe(true)
  })
})

// ─── read-failure diagnostics + concurrency cap ─────────────────────────────────

describe('scanUsedIconIds — read-failure handling and concurrency', () => {
  afterEach(() => vi.restoreAllMocks())

  it('warns (naming the file) when a source file cannot be read, and still returns the icons it did find', async () => {
    await writeSrc('good.vue', '<template><SvgUse name="home" /></template>')
    await writeSrc('bad.vue', '<template><SvgUse name="star" /></template>')
    const realReadFile = fsp.readFile
    vi.spyOn(fsp, 'readFile').mockImplementation(((file: string, ...rest: unknown[]) => {
      if (file.replace(/\\/g, '/').endsWith('/bad.vue')) return Promise.reject(new Error('EACCES: permission denied'))
      return (realReadFile as (...a: unknown[]) => Promise<string>)(file, ...rest)
    }) as typeof fsp.readFile)

    const logger = { info: vi.fn(), warn: vi.fn() }
    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }, { id: 'star', componentName: 'UseStar' }])],
      EXTENSIONS,
      [],
      logger,
    )

    expect(used.has('home')).toBe(true)
    expect(used.has('star')).toBe(false)
    expect(logger.warn).toHaveBeenCalledOnce()
    const [message] = logger.warn.mock.calls[0]!
    expect(message).toContain('bad.vue')
    expect(message).toContain('treeShakingInclude')
  })

  it('a read failure never rejects the scan', async () => {
    await writeSrc('bad.vue', '<template><SvgUse name="home" /></template>')
    vi.spyOn(fsp, 'readFile').mockRejectedValue(new Error('boom'))

    const used = await scanUsedIconIds(
      tmpDir,
      [makeCollection([{ id: 'home', componentName: 'UseHome' }])],
      EXTENSIONS,
      [],
    )
    expect(used.size).toBe(0)
  })

  it('does not warn when every file reads successfully', async () => {
    await writeSrc('app.vue', '<template><SvgUse name="home" /></template>')
    const logger = { info: vi.fn(), warn: vi.fn() }
    await scanUsedIconIds(tmpDir, [makeCollection([{ id: 'home', componentName: 'UseHome' }])], EXTENSIONS, [], logger)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('caps concurrent reads', async () => {
    const fileCount = 100
    for (let i = 0; i < fileCount; i++) {
      await writeSrc(`file-${i}.ts`, `"icon-${i}"`)
    }

    let inFlight = 0
    let maxInFlight = 0
    const realReadFile = fsp.readFile
    vi.spyOn(fsp, 'readFile').mockImplementation((async (file: string, ...rest: unknown[]) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        return await (realReadFile as (...a: unknown[]) => Promise<string>)(file, ...rest)
      }
      finally {
        inFlight--
      }
    }) as typeof fsp.readFile)

    const icons = [{ id: 'icon-0', componentName: 'UseIcon0' }]
    const used = await scanUsedIconIds(tmpDir, [makeCollection(icons)], EXTENSIONS, [])

    expect(maxInFlight).toBeLessThanOrEqual(32)
    expect(used.has('icon-0')).toBe(true)
  })
})
