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

  it('logs a summary via the optional logger', async () => {
    await writeSrc('app.vue', '<template><SvgUse name="home" /></template>')
    const logger = { info: vi.fn() }
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
