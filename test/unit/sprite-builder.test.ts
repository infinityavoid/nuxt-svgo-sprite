import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  defaultSvgoConfig,
  buildSprite,
  totalSpriteBytes,
} from '../../src/builders/sprite-builder'
import type { SymbolCache } from '../../src/builders/sprite-builder'
import type { IconMeta } from '../../src/types/types'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'svgo-sprite-builder-test-'))
})

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}

beforeEach(() => vi.clearAllMocks())

async function makeIcon(id: string, filename = id): Promise<IconMeta> {
  const filePath = path.join(tmpDir, `${filename}.svg`)
  await fsp.writeFile(filePath, SVG, 'utf-8')
  return { id, componentName: `Use${id}`, absolutePath: filePath }
}

async function makeIconWithContent(id: string, content: string): Promise<IconMeta> {
  const filePath = path.join(tmpDir, `${id}.svg`)
  await fsp.writeFile(filePath, content, 'utf-8')
  return { id, componentName: `Use${id}`, absolutePath: filePath }
}

// ─── buildSprite — basic ──────────────────────────────────────────────────────

describe('buildSprite', () => {
  it('produces a sprite containing the expected symbol ids', async () => {
    const icons = [await makeIcon('home'), await makeIcon('star')]
    const sprite = await buildSprite(icons, defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('id="home"')
    expect(sprite).toContain('id="star"')
  })

  it('uses icon.id (not the filename) as the symbol id', async () => {
    const icon = await makeIcon('admin-star', 'star')
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('id="admin-star"')
    expect(sprite).not.toContain('id="star"')
  })

  it('returns empty sprite wrapper and warns when icons array is empty', async () => {
    const sprite = await buildSprite([], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toBe('')
    expect(mockLogger.warn).toHaveBeenCalledOnce()
  })

  it('wraps symbols in a visually-hidden sprite root', async () => {
    const icons = [await makeIcon('home')]
    const sprite = await buildSprite(icons, defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(sprite).toContain('aria-hidden="true"')
    expect(sprite).toContain('position: absolute')
  })

  it('optimizeFiles:false — still produces a valid sprite with correct id', async () => {
    const icon = await makeIcon('check')
    const sprite = await buildSprite([icon], defaultSvgoConfig, false, mockLogger)
    expect(sprite).toContain('id="check"')
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('handles multiple icons with collection-prefixed ids', async () => {
    const icons = [
      await makeIcon('admin-star', 'star'),
      await makeIcon('admin-close', 'close'),
    ]
    const sprite = await buildSprite(icons, defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('id="admin-star"')
    expect(sprite).toContain('id="admin-close"')
  })

  it('produces <symbol> elements, not <svg>', async () => {
    const icon = await makeIcon('home')
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('<symbol')
    expect(sprite).not.toMatch(/<svg[^>]*id=/)
  })
})

// ─── Edge case 1: viewBox preservation ───────────────────────────────────────

describe('viewBox preservation', () => {
  it('preserves viewBox on <symbol> even when width and height are also present', async () => {
    const svgWithDims = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'
    const icon = await makeIconWithContent('icon', svgWithDims)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('viewBox="0 0 24 24"')
    expect(sprite).not.toMatch(/\bwidth="24"/)
    expect(sprite).not.toMatch(/\bheight="24"/)
  })
})

// ─── Edge case 6: id prefixing (global uniqueness) ────────────────────────────

describe('id collision prevention', () => {
  it('two icons with the same internal element id produce no collisions', async () => {
    const SVG_WITH_CLIP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<defs><clipPath id="clip0"><rect width="24" height="24"/></clipPath></defs>'
      + '<circle clip-path="url(#clip0)" cx="12" cy="12" r="10"/></svg>'
    const icon1 = await makeIconWithContent('home', SVG_WITH_CLIP)
    const icon2 = await makeIconWithContent('star', SVG_WITH_CLIP)
    const sprite = await buildSprite([icon1, icon2], defaultSvgoConfig, true, mockLogger)
    const ids = [...sprite.matchAll(/\bid="([^"]*)"/g)].map(m => m[1])
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('url() references in clip-path point to ids that exist in the sprite', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<defs><clipPath id="clip0"><rect width="24" height="24"/></clipPath></defs>'
      + '<circle clip-path="url(#clip0)" cx="12" cy="12" r="10"/></svg>'
    const icon = await makeIconWithContent('home', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    const ids = new Set([...sprite.matchAll(/\bid="([^"]*)"/g)].map(m => m[1]))
    const urlRefs = [...sprite.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1])
    expect(urlRefs.length).toBeGreaterThan(0)
    for (const ref of urlRefs) {
      expect(ids.has(ref)).toBe(true)
    }
  })
})

// ─── Edge case 8: malformed SVG ───────────────────────────────────────────────

describe('malformed SVG handling', () => {
  it('logs error and skips a broken icon, other icons still compile', async () => {
    const broken = await makeIconWithContent('broken', 'NOT VALID XML <<<')
    const good = await makeIcon('good')
    const sprite = await buildSprite([broken, good], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.error).toHaveBeenCalledOnce()
    expect(sprite).toContain('id="good"')
    expect(sprite).not.toContain('id="broken"')
  })
})

// ─── Edge case 9: missing dimensions ─────────────────────────────────────────

describe('missing dimensions', () => {
  it('synthesizes viewBox from width/height when viewBox is absent', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32"/></svg>'
    const icon = await makeIconWithContent('box', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('viewBox="0 0 32 32"')
  })

  it('warns and includes icon when no viewBox or dimensions are present', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32"/></svg>'
    const icon = await makeIconWithContent('nodims', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.warn).toHaveBeenCalledOnce()
    expect(sprite).toContain('id="nodims"')
  })
})

// ─── Edge case 11: raw opt-out ────────────────────────────────────────────────

describe('raw opt-out', () => {
  it('raw svg preserves content SVGO would strip; adjacent icon is still optimized', async () => {
    const SVG_WITH_COMMENT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!-- keep-raw --><circle cx="12" cy="12" r="10"/></svg>'
    const SVG_PLAIN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!-- strip-me --><circle cx="12" cy="12" r="8"/></svg>'
    const rawIcon: IconMeta = { ...(await makeIconWithContent('raw-icon', SVG_WITH_COMMENT)), raw: true }
    const normalIcon = await makeIconWithContent('normal-icon', SVG_PLAIN)
    const sprite = await buildSprite([normalIcon, rawIcon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('keep-raw')
    expect(sprite).not.toContain('strip-me')
  })

  it('raw icon still becomes a <symbol> with correct id', async () => {
    const rawIcon: IconMeta = { ...(await makeIcon('raw-home')), raw: true }
    const sprite = await buildSprite([rawIcon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('id="raw-home"')
    expect(sprite).toContain('<symbol')
  })
})

// ─── Edge case 13: inlineDefs ─────────────────────────────────────────────────

describe('inlineDefs — <use>/<defs> resolution', () => {
  it('an icon with an internal gradient renders in the sprite (gradient stays valid via url())', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<defs><linearGradient id="grad"><stop offset="0%" stop-color="red"/><stop offset="100%" stop-color="blue"/></linearGradient></defs>'
      + '<rect fill="url(#grad)" width="24" height="24"/></svg>'
    const icon = await makeIconWithContent('gradient-icon', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('id="gradient-icon"')
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('actually inlines a <use> reference to a <defs> element, not just avoids erroring', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<defs><path id="p" d="M2 2h20v20H2z"/></defs>'
      + '<use href="#p" x="1" y="1"/></svg>'
    const icon = await makeIconWithContent('use-icon', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    // The <use> and the now-empty <defs> are both gone — the path itself, wrapped in
    // a translate <g>, is what's actually left in the document.
    expect(sprite).not.toContain('<use')
    expect(sprite).not.toContain('<defs')
    expect(sprite).toContain('M2 2h20v20H2z')
    expect(sprite).toContain('translate(1,1)')
  })

  it('two icons with matching internal ids do not cross-reference after merge', async () => {
    const svgA = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<defs><clipPath id="cp"><rect width="24" height="24"/></clipPath></defs>'
      + '<circle clip-path="url(#cp)" cx="12" cy="12" r="10"/></svg>'
    const iconA = await makeIconWithContent('icon-a', svgA)
    const iconB = await makeIconWithContent('icon-b', svgA)
    const sprite = await buildSprite([iconA, iconB], defaultSvgoConfig, true, mockLogger)
    // Every url() reference must point to an id that exists in the sprite
    const ids = new Set([...sprite.matchAll(/\bid="([^"]*)"/g)].map(m => m[1]))
    const refs = [...sprite.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1])
    for (const ref of refs) {
      expect(ids.has(ref)).toBe(true)
    }
  })
})

// ─── Edge case 14: inlineStyles ──────────────────────────────────────────────

describe('inlineStyles — <style> block handling', () => {
  it('icon with a <style> block compiles without error', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<style>.a{fill:red}</style>'
      + '<circle class="a" cx="12" cy="12" r="10"/></svg>'
    const icon = await makeIconWithContent('styled-icon', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('id="styled-icon"')
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('actually inlines the <style> rule onto the matched element, not just avoids erroring', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<style>.a{fill:red}</style>'
      + '<circle class="a" cx="12" cy="12" r="10"/></svg>'
    const icon = await makeIconWithContent('styled-icon-2', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    // The <style> block (and the class that only existed to be targeted by it) must
    // be gone — leaking it into the shared sprite document would apply ".a{fill:red}"
    // to every symbol with an element carrying class="a", not just this one.
    expect(sprite).not.toContain('<style')
    expect(sprite).not.toContain('class="a"')
    expect(sprite).toMatch(/style="[^"]*fill:\s*red/)
  })

  it('cleanupIds still removes now-unused ids on an icon whose class matches more than once', async () => {
    // Regression: inlineStyles used to be appended as a SECOND, separate plugin after
    // preset-default instead of being overridden inside it. cleanupIds (part of the
    // preset) ran first, in the same pass, against the untouched class="a"/<style>
    // markup, and left these ids in place — it couldn't yet see that inlineStyles was
    // about to inline the class away and make them unreferenced. Overriding
    // inlineStyles INSIDE preset-default runs it before cleanupIds in the same pass.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<style>.a{fill:red}</style>'
      + '<rect id="unused1" class="a" width="5" height="5"/>'
      + '<rect id="unused2" class="a" width="5" height="5"/>'
      + '</svg>'
    const icon = await makeIconWithContent('multi-matched-class', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).not.toContain('id="unused1"')
    expect(sprite).not.toContain('id="unused2"')
  })
})

// ─── Edge case 15: input already contains <symbol> ───────────────────────────

describe('input already contains <symbol>', () => {
  it('logs error and skips file that already has <symbol> elements', async () => {
    const spriteFile = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="x"><circle cx="12" cy="12" r="10"/></symbol></svg>'
    const icon = await makeIconWithContent('bad-input', spriteFile)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.error).toHaveBeenCalledOnce()
    expect(sprite).not.toContain('id="bad-input"')
  })

  it('does not false-positive on a comment mentioning <symbol>', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!-- <symbol> --><circle cx="12" cy="12" r="10"/></svg>'
    const icon = await makeIconWithContent('commented', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(sprite).toContain('id="commented"')
  })
})

// ─── Phase 15 audit fixes ─────────────────────────────────────────────────────

describe('svgoConfig override (replace, not merge)', () => {
  it('a user plugin list fully replaces the defaults instead of running alongside them', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!-- keep me --><circle cx="12" cy="12" r="10"/></svg>'
    const icon = await makeIconWithContent('kept-comment', svg)
    const userConfig: Parameters<typeof buildSprite>[1] = {
      plugins: [
        { name: 'preset-default', params: { overrides: { removeViewBox: false, removeComments: false } } },
      ],
    }
    const sprite = await buildSprite([icon], userConfig, true, mockLogger)
    // If defu-style array-concat merge were still happening, the bare 'preset-default'
    // from defaultSvgoConfig would run afterwards with its own (comment-stripping) config
    // and remove this regardless of the user's override.
    expect(sprite).toContain('keep me')
  })

  it('falls back to defaultSvgoConfig when the user provides no svgoConfig', async () => {
    const icon = await makeIcon('home')
    const sprite = await buildSprite([icon], undefined, true, mockLogger)
    expect(sprite).toContain('id="home"')
  })

  it('non-plugins keys of the user svgoConfig (e.g. js2svg) are honored, not silently dropped', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'
    const icon = await makeIconWithContent('pretty', svg)
    const userConfig: Parameters<typeof buildSprite>[1] = {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 4 },
    }
    const sprite = await buildSprite([icon], userConfig, true, mockLogger)
    // js2svg.pretty/indent inserts real indentation into the serialized output — if
    // the option were dropped, the child element would stay on the same line as its
    // parent with no leading spaces.
    expect(sprite).toContain('    <circle')
  })
})

describe('XML prolog / doctype stripping on the raw path', () => {
  it('strips <?xml?> and <!DOCTYPE> for a raw icon', async () => {
    const svg = '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">'
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'
    const rawIcon: IconMeta = { ...(await makeIconWithContent('raw-prolog', svg)), raw: true }
    const sprite = await buildSprite([rawIcon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).not.toContain('<?xml')
    expect(sprite).not.toContain('<!DOCTYPE')
    expect(sprite).toContain('id="raw-prolog"')
  })

  it('strips <?xml?> and <!DOCTYPE> when optimizeFiles is false', async () => {
    const svg = '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">'
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'
    const icon = await makeIconWithContent('noopt-prolog', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, false, mockLogger)
    expect(sprite).not.toContain('<?xml')
    expect(sprite).not.toContain('<!DOCTYPE')
  })
})

describe('non-<svg>-root and empty-file rejection', () => {
  it('logs error and skips a file whose root element is not <svg>', async () => {
    const icon = await makeIconWithContent('not-svg', '<html><body>x</body></html>')
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.error).toHaveBeenCalledOnce()
    expect(sprite).not.toContain('not-svg')
    expect(sprite).not.toContain('<html')
  })

  it('logs error and skips an empty file', async () => {
    const icon = await makeIconWithContent('empty', '')
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.error).toHaveBeenCalledOnce()
    expect(sprite).not.toContain('id="empty"')
  })
})

describe('prefixClassNames — conditional on whether a <style> block can survive', () => {
  it('optimized path: does not rewrite user class names (inlineStyles already removed the <style> block)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path class="stroke" d="M1 1h9"/></svg>'
    const icon = await makeIconWithContent('classy', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('class="stroke"')
  })

  it('raw path: DOES prefix class names, because the <style> block survives into the shared sprite document', async () => {
    // Regression: prefixClassNames: false unconditionally meant two .raw.svg icons
    // each shipping <style>.cls-1{fill:red}</style> collided in the merged sprite —
    // a <style> tag inside inline SVG is document-scoped, so the second icon's rule
    // silently overrode the first's.
    const svgA = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.cls-1{fill:red}</style><path class="cls-1" d="M1 1h9"/></svg>'
    const svgB = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.cls-1{fill:blue}</style><path class="cls-1" d="M2 2h9"/></svg>'
    const iconA: IconMeta = { ...(await makeIconWithContent('style-a', svgA)), raw: true }
    const iconB: IconMeta = { ...(await makeIconWithContent('style-b', svgB)), raw: true }
    const sprite = await buildSprite([iconA, iconB], defaultSvgoConfig, true, mockLogger)

    // Both rules must survive, under DISTINCT (prefixed) class names — not the same
    // ".cls-1" for both, which would make the second definition win for both icons.
    expect(sprite).toContain('fill:red')
    expect(sprite).toContain('fill:blue')
    const classNames = [...sprite.matchAll(/class="([^"]+)"/g)].map(m => m[1])
    expect(new Set(classNames).size).toBe(2)
  })

  it('raw path: does NOT warn for a class-scoped rule — prefixing already scopes it safely', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.cls-1{fill:red}</style><path class="cls-1" d="M1 1h9"/></svg>'
    const icon: IconMeta = { ...(await makeIconWithContent('scoped-style', svg)), raw: true }
    await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})

describe('raw path: unscoped <style> selector leaks page-wide (item #12)', () => {
  it('an element-selector rule survives verbatim into the sprite — documents the known limitation', async () => {
    // Verified directly against real SVGO: on the raw/optimizeFiles:false path,
    // optimizationPlugins is empty, so nothing removes or scopes this rule. Once the
    // sprite is inlined into the host page, "circle { fill: red !important }" applies
    // to EVERY <circle> on the page, not just this icon's <symbol>.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>circle{fill:red!important}</style><circle cx="12" cy="12" r="10"/></svg>'
    const icon: IconMeta = { ...(await makeIconWithContent('unscoped', svg)), raw: true }
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('circle{fill:red!important}')
  })

  it('warns when a raw-path <style> rule has no class selector', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>circle{fill:red}</style><circle cx="12" cy="12" r="10"/></svg>'
    const icon: IconMeta = { ...(await makeIconWithContent('unscoped-2', svg)), raw: true }
    await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no class selector'))
  })

  it('warns for a wildcard selector', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>*{opacity:0}</style><circle cx="12" cy="12" r="10"/></svg>'
    const icon: IconMeta = { ...(await makeIconWithContent('wildcard', svg)), raw: true }
    await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no class selector'))
  })

  it('does not warn on the optimized path (default) even for an element selector — inlineStyles removes the <style> block before this would matter', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>circle{fill:red}</style><circle cx="12" cy="12" r="10"/></svg>'
    const icon = await makeIconWithContent('optimized-unscoped', svg)
    await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('does not warn when a compound selector includes a class anywhere (e.g. descendant combinator)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.icon circle{fill:red}</style><g class="icon"><circle cx="12" cy="12" r="10"/></g></svg>'
    const icon: IconMeta = { ...(await makeIconWithContent('compound', svg)), raw: true }
    await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})

describe('script stripping', () => {
  const SCRIPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)"><script>alert(2)</script><circle cx="12" cy="12" r="10"/></svg>'

  it('removes <script> elements and on* event handlers', async () => {
    const icon = await makeIconWithContent('scripty', SCRIPTY_SVG)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).not.toContain('<script')
    expect(sprite).not.toContain('onload')
  })

  it('still strips scripts for a .raw.svg icon (raw only skips optimization, not this invariant)', async () => {
    const rawIcon: IconMeta = { ...(await makeIconWithContent('scripty-raw', SCRIPTY_SVG)), raw: true }
    const sprite = await buildSprite([rawIcon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).not.toContain('<script')
    expect(sprite).not.toContain('onload')
  })

  it('still strips scripts when optimizeFiles is false', async () => {
    const icon = await makeIconWithContent('scripty-noopt', SCRIPTY_SVG)
    const sprite = await buildSprite([icon], defaultSvgoConfig, false, mockLogger)
    expect(sprite).not.toContain('<script')
    expect(sprite).not.toContain('onload')
  })

  it('still strips scripts when the user supplies their own svgoConfig', async () => {
    const icon = await makeIconWithContent('scripty-custom', SCRIPTY_SVG)
    const userConfig: Parameters<typeof buildSprite>[1] = { plugins: ['preset-default'] }
    const sprite = await buildSprite([icon], userConfig, true, mockLogger)
    expect(sprite).not.toContain('<script')
    expect(sprite).not.toContain('onload')
  })
})

describe('all icons in a collection fail', () => {
  it('warns explicitly when every icon in a non-empty collection failed to process', async () => {
    const icon = await makeIconWithContent('not-svg-2', '<html></html>')
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('failed to process'))
    expect(sprite).not.toContain('<symbol')
  })
})

describe('missing dimensions — px unit handling', () => {
  it('synthesizes viewBox from width/height expressed in px', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px"><rect width="24" height="24"/></svg>'
    const icon = await makeIconWithContent('px-dims', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('viewBox="0 0 24 24"')
  })
})

describe('onIconResult callback', () => {
  it('reports included: true for an icon that made it into the sprite', async () => {
    const icon = await makeIcon('home')
    const results: [string, boolean][] = []
    await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', (i, included) => results.push([i.id, included]))
    expect(results).toEqual([['home', true]])
  })

  it('reports included: false for an icon rejected during processing, without including it', async () => {
    const good = await makeIcon('good')
    const bad = await makeIconWithContent('bad', '<html></html>')
    const results: [string, boolean][] = []
    await buildSprite([good, bad], defaultSvgoConfig, true, mockLogger, 'default', (i, included) => results.push([i.id, included]))
    expect(results).toContainEqual(['good', true])
    expect(results).toContainEqual(['bad', false])
  })
})

describe('symbolCache — skips re-reading/re-optimizing unchanged icons', () => {
  it('a cache hit (mtime unchanged) returns the previously-computed symbol without re-reading the file', async () => {
    // Seed the cache directly with the icon's REAL current mtime and a recognizable
    // sentinel symbol, rather than relying on two real fs writes landing on exactly
    // the same mtimeMs (filesystem timestamp resolution makes that flaky in both
    // directions — confirmed by hand, this is not hypothetical). The point under
    // test is purely "does buildSprite trust a cache entry whose mtime matches the
    // real file's current mtime," which this tests directly and deterministically.
    const icon = await makeIcon('cached')
    const { mtimeMs } = await fsp.stat(icon.absolutePath)
    const cache: SymbolCache = new Map([
      [icon.absolutePath, { mtimeMs, symbol: '<symbol id="cached">SENTINEL</symbol>' }],
    ])

    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, cache)
    expect(sprite).toContain('SENTINEL')
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('a stale cache entry (mtime does not match the real file) is ignored and the icon is reprocessed', async () => {
    const icon = await makeIcon('live')
    const { mtimeMs } = await fsp.stat(icon.absolutePath)
    const cache: SymbolCache = new Map([
      // A different mtime than the real file's current one -> must not be trusted.
      [icon.absolutePath, { mtimeMs: mtimeMs - 10_000, symbol: '<symbol id="live">STALE</symbol>' }],
    ])

    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, cache)
    expect(sprite).not.toContain('STALE')
    expect(sprite).toContain('id="live"')
  })

  it('actually reuses a REAL cache entry populated by a prior buildSprite call, across two calls with no write in between', async () => {
    // Complements the seeded-cache tests above with an end-to-end round trip: call
    // once to populate the cache for real, then call again with nothing touching the
    // file in between (so the mtime genuinely cannot have changed) and confirm the
    // second call didn't need to re-log or re-derive anything new.
    const icon = await makeIcon('roundtrip')
    const cache: SymbolCache = new Map()

    const first = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, cache)
    expect(cache.has(icon.absolutePath)).toBe(true)

    const second = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, cache)
    expect(second).toBe(first)
  })

  it('a cached rejection is not re-logged on the next unchanged rebuild', async () => {
    const icon = await makeIconWithContent('broken-cached', '<html></html>')
    const cache: SymbolCache = new Map()

    await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, cache)
    expect(mockLogger.error).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    const second = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, cache)
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(second).not.toContain('broken-cached')
  })

  it('without a cache, two calls for the same unchanged icon both re-read it (no caching by default)', async () => {
    const svgA = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="1" cy="1" r="1"/></svg>'
    const svgB = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="2" cy="2" r="2"/></svg>'
    const icon = await makeIconWithContent('nocache', svgA)

    await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    await fsp.writeFile(icon.absolutePath, svgB, 'utf-8')
    const second = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(second).toContain('cx="2"')
  })
})

// ─── totalSpriteBytes ───────────────────────────────────────────────────────────

describe('totalSpriteBytes', () => {
  it('sums UTF-8 byte length across every collection', () => {
    const contents = new Map([
      ['default', 'abc'], // 3 bytes
      ['admin', 'defgh'], // 5 bytes
    ])
    expect(totalSpriteBytes(contents)).toBe(8)
  })

  it('counts multi-byte characters by their actual byte length, not .length', () => {
    // '★' is 1 UTF-16 code unit (.length === 1) but 3 UTF-8 bytes.
    const contents = new Map([['default', '★']])
    expect(totalSpriteBytes(contents)).toBe(3)
    expect('★'.length).toBe(1)
  })

  it('returns 0 for an empty map', () => {
    expect(totalSpriteBytes(new Map())).toBe(0)
  })
})

// ─── normalizeColors (item #7) ───────────────────────────────────────────────────

describe('normalizeColors', () => {
  it('off by default: a literal fill/stroke color is left untouched', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ff0000" stroke="black" d="M1 1h9"/></svg>'
    const icon = await makeIconWithContent('literal-color', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    // SVGO's own preset-default minifies color values (#ff0000 -> red, black -> #000)
    // — that's unrelated to normalizeColors; the point here is neither becomes
    // "currentColor".
    expect(sprite).toContain('fill="red"')
    expect(sprite).toContain('stroke="#000"')
  })

  it('rewrites a literal fill and stroke to currentColor when enabled', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ff0000" stroke="black" d="M1 1h9"/></svg>'
    const icon = await makeIconWithContent('to-normalize', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, undefined, { normalize: true })
    expect(sprite).toContain('fill="currentColor"')
    expect(sprite).toContain('stroke="currentColor"')
    expect(sprite).not.toContain('#ff0000')
  })

  it('leaves fill="none" alone — that is a deliberate "no fill", not a color to normalize', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="red" d="M1 1h9"/></svg>'
    const icon = await makeIconWithContent('none-fill', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, undefined, { normalize: true })
    expect(sprite).toContain('fill="none"')
    expect(sprite).toContain('stroke="currentColor"')
  })

  it('does not touch a url(#id) reference into a gradient/pattern def — rewriting it would break the reference, not recolor anything', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>'
      + '<path fill="url(#g)" d="M1 1h9"/></svg>'
    const icon = await makeIconWithContent('gradient-ref', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, undefined, { normalize: true })
    expect(sprite).toContain('fill="url(#')
    expect(sprite).not.toContain('fill="currentColor"')
  })

  it('leaves an icon alone when its id matches the exclude pattern', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ff0000" d="M1 1h9"/></svg>'
    const icon = await makeIconWithContent('brand-logo', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, undefined, {
      normalize: true,
      exclude: /^brand-/,
    })
    expect(sprite).toContain('fill="red"')
    expect(sprite).not.toContain('currentColor')
  })

  it('still normalizes an icon that does NOT match the exclude pattern', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ff0000" d="M1 1h9"/></svg>'
    const icon = await makeIconWithContent('plain-icon', svg)
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, undefined, {
      normalize: true,
      exclude: /^brand-/,
    })
    expect(sprite).toContain('fill="currentColor"')
  })

  it('applies on the raw path too, since it runs in the structural block, not defaultSvgoConfig', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ff0000" d="M1 1h9"/></svg>'
    const icon: IconMeta = { ...(await makeIconWithContent('raw-normalize', svg)), raw: true }
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, undefined, { normalize: true })
    expect(sprite).toContain('fill="currentColor"')
  })

  it('applies even when the user supplies their own svgoConfig (structural block survives replacement — ADR-021)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ff0000" d="M1 1h9"/></svg>'
    const icon = await makeIconWithContent('user-config-normalize', svg)
    const userConfig: Parameters<typeof buildSprite>[1] = { plugins: ['preset-default'] }
    const sprite = await buildSprite([icon], userConfig, true, mockLogger, 'default', undefined, undefined, { normalize: true })
    expect(sprite).toContain('fill="currentColor"')
  })
})

// ─── isUsed (item #6, tree-shaking) ───────────────────────────────────────────────

describe('isUsed', () => {
  it('every icon is included when isUsed is undefined (default, fully backward compatible)', async () => {
    const icon = await makeIcon('home')
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger)
    expect(sprite).toContain('id="home"')
  })

  it('excludes an icon from the sprite when isUsed returns false', async () => {
    const used = await makeIcon('home')
    const unused = await makeIcon('star')
    const sprite = await buildSprite(
      [used, unused],
      defaultSvgoConfig,
      true,
      mockLogger,
      'default',
      undefined,
      undefined,
      undefined,
      icon => icon.id === 'home',
    )
    expect(sprite).toContain('id="home"')
    expect(sprite).not.toContain('id="star"')
  })

  it('an excluded icon still succeeds processing — onIconResult still reports included=true (types/DevTools/Use* stay unaffected by tree-shaking)', async () => {
    const unused = await makeIcon('star')
    const onIconResult = vi.fn()
    await buildSprite(
      [unused],
      defaultSvgoConfig,
      true,
      mockLogger,
      'default',
      onIconResult,
      undefined,
      undefined,
      () => false,
    )
    expect(onIconResult).toHaveBeenCalledWith(unused, true)
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('an excluded icon still gets cached — a later call with the same cache and no isUsed sees the cached symbol', async () => {
    const icon = await makeIcon('star')
    const cache: SymbolCache = new Map()
    await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, cache, undefined, () => false)
    expect(cache.has(icon.absolutePath)).toBe(true)

    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, cache)
    expect(sprite).toContain('id="star"')
  })

  it('an excluded icon is also excluded on a cache hit', async () => {
    const icon = await makeIcon('star')
    const cache: SymbolCache = new Map()
    // First call: included, populates the cache.
    await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, cache)
    vi.clearAllMocks()
    // Second call, same cache (hit) but now excluded.
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, cache, undefined, () => false)
    expect(sprite).not.toContain('id="star"')
  })

  it('logs info (not a warning) when every icon in a non-empty collection was tree-shaken out — distinct from the "all failed to process" warning', async () => {
    const icon = await makeIcon('star')
    const sprite = await buildSprite([icon], defaultSvgoConfig, true, mockLogger, 'default', undefined, undefined, undefined, () => false)
    expect(sprite).toBe('')
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('tree-shaken'))
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('still logs the "all failed to process" warning when icons genuinely fail, not just get shaken', async () => {
    const badIcon = await makeIconWithContent('bad', '<html>not an svg</html>')
    const sprite = await buildSprite([badIcon], defaultSvgoConfig, true, mockLogger, 'default', undefined, undefined, undefined, () => false)
    expect(sprite).toBe('')
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('failed to process'))
  })
})
