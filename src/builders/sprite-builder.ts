import { optimize } from 'svgo'
import type { Config as SvgoConfig } from 'svgo'
import { promises as fsp } from 'node:fs'
import type { IconMeta } from '../types/types'

// Minimal SVGO AST types for custom plugin callbacks.
// These mirror SVGO's internal XastElement / XastRoot / XastParent.
type AstElement = {
  type: 'element'
  name: string
  attributes: Record<string, string>
  children: AstNode[]
}
type AstRoot = { type: 'root', children: AstNode[] }
type AstNode = AstElement | { type: string, children?: AstNode[] }
type AstParent = AstElement | AstRoot

// Attribute allowlist for <symbol> elements (ported from svg-sprite/lib/svg-sprite/mode/symbol.js,
// minus event-handler attributes — script/event stripping is handled unconditionally by the
// removeScripts plugin below, so listing onclick/onload etc. here would be redundant).
const SYMBOL_ATTRIBUTES = new Set([
  'id',
  'xml:base', 'xml:lang', 'xml:space',
  'alignment-baseline', 'baseline-shift', 'clip', 'clip-path', 'clip-rule',
  'color', 'color-interpolation', 'color-interpolation-filters', 'color-profile', 'color-rendering',
  'cursor', 'direction', 'display', 'dominant-baseline', 'enable-background',
  'fill', 'fill-opacity', 'fill-rule', 'filter', 'flood-color', 'flood-opacity',
  'font-family', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style',
  'font-variant', 'font-weight', 'glyph-orientation-horizontal', 'glyph-orientation-vertical',
  'image-rendering', 'kerning', 'letter-spacing', 'lighting-color',
  'marker-end', 'marker-mid', 'marker-start', 'mask', 'opacity', 'overflow',
  'pointer-events', 'shape-rendering', 'stop-color', 'stop-opacity',
  'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-opacity', 'stroke-width',
  'text-anchor', 'text-decoration', 'text-rendering', 'unicode-bidi',
  'visibility', 'word-spacing', 'writing-mode',
  'class', 'style', 'externalResourcesRequired', 'preserveAspectRatio', 'viewBox',
  'aria-labelledby',
])

const SPRITE_STYLE = 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;'

// Regex to detect files that are already sprites (contain <symbol>). Matched against
// the source with comments stripped first, and requires a tag boundary after "symbol"
// so a comment like "<!-- <symbol> -->" or an element named <symbolic> don't false-positive.
const HAS_SYMBOL_RE = /<symbol[\s/>]/i
const COMMENT_RE = /<!--[\s\S]*?-->/g

export interface SpriteLogger {
  error(msg: string): void
  warn(msg: string): void
  info(msg: string): void
}

// ─── Default SVGO config ──────────────────────────────────────────────────────

export const defaultSvgoConfig: SvgoConfig = {
  plugins: [
    // inlineStyles is overridden INSIDE preset-default (not appended as a second,
    // separate plugin afterward) so it runs in its normal position within
    // preset-default's own single pass, before cleanupIds gets its turn. A second,
    // independent inlineStyles pass appended after preset-default runs too late:
    // cleanupIds (also part of the preset) has already run against the untouched
    // <style>/class-based markup by then, and leaves ids referenced by a
    // multiple-times-matched class in place because it can't yet see that those
    // classes are about to be inlined away. Verified directly: the two-pass form
    // left `id="unused1"`/`id="unused2"` in optimizer output for a two-element
    // multi-matched `.a` class; the overrides form removed both.
    //
    // No removeViewBox override: SVGO 4's preset-default doesn't include that plugin,
    // and overriding a plugin the preset doesn't run prints a "not part of
    // preset-default" warning per icon per build. The "viewBox preservation" test in
    // sprite-builder.test.ts is the tripwire — if a future SVGO reintroduces
    // removeViewBox into the preset, that test starts failing and this needs revisiting.
    { name: 'preset-default', params: { overrides: { inlineStyles: { onlyMatchedOnce: false } } } },
    { name: 'removeAttrs', params: { attrs: ['svg:id'] } },
    { name: 'removeDimensions' },
    { name: 'removeXMLNS' },
  ],
}

// ─── Custom SVGO plugins ──────────────────────────────────────────────────────

// Resolves <use xlink:href="#id"> references to <defs> elements in-place,
// preventing cross-symbol id-reference breaks when symbols are merged into a sprite.
// Ported and adapted from nuxt-modules/svg-sprite's inlineDefs plugin.
function makeInlineDefsPlugin(): Record<string, unknown> {
  return {
    name: 'inlineDefs',
    fn: () => ({
      root: {
        exit(root: AstRoot) {
          const defsMap = new Map<string, { node: AstElement, defsParent: AstElement }>()

          function collectDefs(parent: AstParent) {
            for (const child of parent.children) {
              if (child.type !== 'element') continue
              const el = child as AstElement
              if (el.name === 'defs') {
                for (const def of el.children) {
                  if (def.type === 'element') {
                    const defEl = def as AstElement
                    if (defEl.attributes.id) {
                      defsMap.set(defEl.attributes.id, { node: defEl, defsParent: el })
                    }
                  }
                }
              }
              else {
                collectDefs(el)
              }
            }
          }

          collectDefs(root)
          if (defsMap.size === 0) return

          const inlinedIds = new Set<string>()

          function inlineUses(parent: AstParent) {
            for (let i = parent.children.length - 1; i >= 0; i--) {
              const child = parent.children[i]
              if (!child || child.type !== 'element') continue
              const el = child as AstElement

              if (el.name === 'use') {
                const href = el.attributes.href || el.attributes['xlink:href'] || ''
                if (href.startsWith('#')) {
                  const targetId = href.slice(1)
                  const entry = defsMap.get(targetId)
                  if (entry) {
                    const clone = JSON.parse(JSON.stringify(entry.node)) as AstElement
                    for (const [k, v] of Object.entries(el.attributes)) {
                      if (!['href', 'xlink:href', 'x', 'y', 'id'].includes(k)) {
                        clone.attributes[k] = v
                      }
                    }
                    const x = el.attributes.x
                    const y = el.attributes.y
                    let replacement: AstElement = clone
                    if (x || y) {
                      replacement = {
                        type: 'element',
                        name: 'g',
                        attributes: { transform: `translate(${x ?? 0},${y ?? 0})` },
                        children: [clone],
                      }
                    }
                    parent.children.splice(i, 1, replacement)
                    inlinedIds.add(targetId)
                  }
                }
              }
              else {
                inlineUses(el)
              }
            }
          }

          inlineUses(root)

          if (inlinedIds.size > 0) {
            function cleanDefs(parent: AstParent) {
              for (let i = parent.children.length - 1; i >= 0; i--) {
                const child = parent.children[i]
                if (!child || child.type !== 'element') continue
                const el = child as AstElement
                if (el.name === 'defs') {
                  el.children = el.children.filter((c) => {
                    if (c.type !== 'element') return true
                    const ce = c as AstElement
                    return !(ce.attributes.id && inlinedIds.has(ce.attributes.id))
                  })
                  if (el.children.length === 0) {
                    parent.children.splice(i, 1)
                  }
                }
                else {
                  cleanDefs(el)
                }
              }
            }
            cleanDefs(root)
          }
        },
      },
    }),
  }
}

// Renames the root <svg> to <symbol>, strips non-symbol attributes via allowlist,
// and sets the icon id. Runs last so prior plugins operate on a valid <svg>.
function makeConvertToSymbolPlugin(iconId: string): Record<string, unknown> {
  return {
    name: 'convertToSymbol',
    fn: () => ({
      element: {
        enter(node: AstElement, parentNode: AstParent) {
          if (node.name === 'svg' && parentNode.type === 'root') {
            node.name = 'symbol'
            node.attributes = Object.fromEntries(
              Object.entries(node.attributes).filter(([attr]) => SYMBOL_ATTRIBUTES.has(attr)),
            )
            node.attributes.id = iconId
          }
        },
      },
    }),
  }
}

// Rewrites literal fill/stroke color VALUES to "currentColor", so an icon's color can
// be controlled from outside (CSS `color`, or a `<SvgUse fill="...">`/`stroke="..."`
// attribute forwarded onto the wrapping <svg>) instead of being locked to whatever
// color the source file happened to be authored/exported with. Skips values that
// are already dynamic or aren't a literal color: "none" (explicitly no fill/stroke),
// "currentColor" itself, "transparent"/"inherit", a CSS custom property (var(...)),
// and a url(#id) reference into a <linearGradient>/<pattern> def (rewriting that would
// break the reference, not recolor anything).
const COLOR_ATTRS = ['fill', 'stroke'] as const
const NON_LITERAL_COLOR_VALUES = new Set(['none', 'currentColor', 'transparent', 'inherit'])

function isLiteralColorValue(value: string): boolean {
  const v = value.trim()
  if (NON_LITERAL_COLOR_VALUES.has(v)) return false
  if (v.startsWith('url(') || v.startsWith('var(')) return false
  return v.length > 0
}

function makeNormalizeColorsPlugin(): Record<string, unknown> {
  return {
    name: 'normalizeColors',
    fn: () => ({
      element: {
        enter(node: AstElement) {
          for (const attr of COLOR_ATTRS) {
            const value = node.attributes[attr]
            if (value !== undefined && isLiteralColorValue(value)) {
              node.attributes[attr] = 'currentColor'
            }
          }
        },
      },
    }),
  }
}

// ─── Config builder ───────────────────────────────────────────────────────────

function iconIdPrefix(spriteName: string, iconId: string): string {
  const safe = iconId.replace(/[^a-z0-9]/gi, '_')
  return `${spriteName}__${safe}__`
}

// User svgoConfig.plugins, when provided, REPLACES the built-in default list rather
// than merging with it — Nuxt/defu's array-concat merge would otherwise let the
// defaults run a second time after the user's plugins and silently undo their
// overrides. `svgoConfig` is intentionally NOT registered in
// defineNuxtModule's `defaults`, so `options.svgoConfig` is undefined unless the user
// set it. Non-`plugins` keys of the user's config (multipass, floatPrecision, js2svg,
// ...) are passed through as-is; only `plugins` gets the replace treatment.
export interface ColorNormalizationOptions {
  /** Rewrite literal fill/stroke values to "currentColor". @default false */
  normalize: boolean
  /**
   * Icons whose id matches are left untouched — for icons that intentionally keep
   * multi-color fills (e.g. a colored logo). Tested against `icon.id`. A `g`/`y`
   * flag on this RegExp is neutralized internally (see `makeExcludeMatcher`) — the
   * caller's own RegExp object is never mutated and never reused statefully.
   */
  exclude?: RegExp
}

// RegExp#test on a `g`- or `y`-flagged pattern is STATEFUL — it advances
// `lastIndex` on a match and resumes from there next call. buildIconConfig is
// called once per icon, all sharing the SAME `colorOptions.exclude` object
// (module.ts constructs it once; buildSprite forwards it unchanged across every
// icon, every collection, and every HMR rebuild) — so a `/g`/`/y` exclude pattern
// would produce alternating true/false results across icons that should all match
// identically. Builds ONE stateless copy (flags stripped of g/y only — i/m/s/u/v/d
// are preserved) up front, reused for every `.test()` call; `undefined` short-
// circuits to a matcher that never excludes.
function makeExcludeMatcher(exclude: RegExp | undefined): (id: string) => boolean {
  if (!exclude) return () => false
  const stateless = /[gy]/.test(exclude.flags)
    ? new RegExp(exclude.source, exclude.flags.replace(/[gy]/g, ''))
    : exclude
  return id => stateless.test(id)
}

function buildIconConfig(
  userSvgoConfig: SvgoConfig | undefined,
  spriteName: string,
  icon: IconMeta,
  optimizeFiles: boolean,
  shouldNormalizeColors: boolean,
): SvgoConfig {
  const skipOptimization = !optimizeFiles || icon.raw === true
  const optimizationPlugins = skipOptimization
    ? []
    : (userSvgoConfig?.plugins ?? defaultSvgoConfig.plugins ?? [])
  // A pre-optimization normalize pass is required too, not just the post-optimization
  // one below. preset-default's removeUnknownsAndDefaults strips a
  // literal fill/stroke value that equals that attribute's SVG-spec INITIAL value
  // (fill defaults to black) as a redundant "default attribute" — verified live: a
  // plain fill="#000000" survives with removeUselessStrokeAndFill disabled, but is
  // gone with only removeUnknownsAndDefaults's defaultAttrs enabled. Rewriting to
  // currentColor BEFORE that plugin runs makes it a non-default value the optimizer
  // has no reason to touch. Only guarded (not the whole structural block) — moving
  // convertToSymbol/inlineDefs/prefixIds earlier breaks the pipeline (see below).
  const guardOptimizer = shouldNormalizeColors && !skipOptimization
  return {
    ...userSvgoConfig,
    plugins: [
      ...(guardOptimizer ? [makeNormalizeColorsPlugin()] : []),
      ...optimizationPlugins,
      // Structural plugins below always run, independent of optimizeFiles/raw and of
      // the user's svgoConfig — they are not "optimization", they are invariants the
      // sprite pipeline itself depends on to produce a valid, safe, non-colliding
      // <symbol> regardless of which path produced it.
      { name: 'removeXMLProcInst' },
      { name: 'removeDoctype' },
      // Icon SVGs are inlined into every SSR page; strip embedded <script>/event
      // handlers unconditionally — this must NOT be skippable via optimizeFiles:
      // false, .raw.svg, or a user-supplied svgoConfig (which replaces the
      // optimization list above, not this structural block).
      { name: 'removeScripts' },
      makeInlineDefsPlugin(),
      // preset-default's inlineStyles (strengthened above with
      // onlyMatchedOnce: false) converts a <style>+class color into a style="" VALUE,
      // which makeNormalizeColorsPlugin below never sees — it only reads the fill/
      // stroke ATTRIBUTES. convertStyleToAttrs (a real, un-deprecated SVGO plugin,
      // NOT part of preset-default) converts style="" properties back to attributes,
      // making the post-pass below see them. Guarded the same way as the pre-pass:
      // never runs when normalizeColors is off (byte-identical plugin list to
      // before), and never on the raw/optimizeFiles:false path (.raw.svg means "ship
      // my markup as authored" — this rewrites every style="" property, not just
      // fill/stroke, and drops `!important`, more restructuring than that contract
      // allows; normalizeColors handles attributes only on the raw path).
      ...(guardOptimizer ? [{ name: 'convertStyleToAttrs' }] : []),
      // Opt-in (colorOptions.normalize, default false) — kept in the structural
      // block rather than defaultSvgoConfig so it still applies when the user sets
      // their own svgoConfig (which replaces the optimization list, not this block).
      // Also the ONLY normalize pass on the raw path (guardOptimizer is always false
      // there), and the pass that catches a non-black literal color the pre-pass
      // above didn't need to touch.
      ...(shouldNormalizeColors ? [makeNormalizeColorsPlugin()] : []),
      {
        name: 'prefixIds',
        params: {
          prefix: iconIdPrefix(spriteName, icon.id),
          delim: '',
          prefixIds: true,
          // Only prefix class names when a <style> block can survive into the merged
          // sprite (i.e. the raw/unoptimized path) — that's the only case where two
          // icons' identically-named classes could collide in the shared document.
          // On the optimized path, inlineStyles already turns classes into inline
          // style="" attributes and removes the <style> block, so there is nothing
          // left for a class-name collision to apply to, and prefixing would only
          // rewrite classes a consumer's own external CSS might target.
          prefixClassNames: skipOptimization,
        },
      },
      makeConvertToSymbolPlugin(icon.id),
    ] as SvgoConfig['plugins'],
  }
}

// ─── View box fallback ────────────────────────────────────────────────────────

// Synthesizes viewBox from width/height when viewBox is absent.
function ensureViewBox(svg: string): string {
  if (/\bviewBox\s*=/.test(svg)) return svg
  // Only the unitless/px cases are handled — other CSS units (em, pt, %, ...) on a
  // root <svg> width/height are rare for icon assets and are left to the "no viewBox
  // or dimensions" warning path below.
  const w = svg.match(/<svg[^>]*\swidth\s*=\s*["']([0-9.]+)(?:px)?["']/)?.[1]
  const h = svg.match(/<svg[^>]*\sheight\s*=\s*["']([0-9.]+)(?:px)?["']/)?.[1]
  if (w && h) {
    return svg.replace(/(<svg\b)/, `$1 viewBox="0 0 ${w} ${h}"`)
  }
  return svg
}

// ─── Raw-path <style> scoping check ───────────────────────────────────────────

// On the raw/optimizeFiles:false path, a source <style> block survives verbatim into
// the shared sprite document (optimizationPlugins is empty there — see
// buildIconConfig). A CLASS selector is safe: prefixClassNames (above) rewrites it to
// an icon-unique name, so it can only ever match elements inside this one icon. A
// selector with no class component at all (an element type, "*", an attribute
// selector, an id) has nothing for prefixing to scope — once inlined, it applies
// page-wide to every matching element, not just this icon's <symbol>. This is a
// heuristic, warning-only check (deliberately conservative: it flags a selector only
// when NONE of its parts reference a class at all, so a compound/descendant selector
// that includes a class anywhere, e.g. ".icon circle", is not flagged — prefixing
// already scopes it via the class part). Nested at-rules (@media, @supports, ...) are
// not parsed into their inner rules; only the outer at-rule prelude is checked
// (harmless — it starts with "@" and is skipped), so a selector inside a nested block
// can be missed. That's an accepted limitation of a lightweight, non-destructive
// warning, not a silent correctness claim.
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g

function hasUnscopedStyleSelector(svg: string): boolean {
  STYLE_BLOCK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = STYLE_BLOCK_RE.exec(svg))) {
    const css = match[1]!.replace(CSS_COMMENT_RE, '')
    for (const chunk of css.split('}')) {
      const selectorGroup = chunk.split('{')[0]!.trim()
      if (!selectorGroup || selectorGroup.startsWith('@')) continue
      for (const selector of selectorGroup.split(',')) {
        if (!selector.includes('.')) return true
      }
    }
  }
  return false
}

// ─── Sprite assembly ──────────────────────────────────────────────────────────

function buildSpriteWrapper(symbols: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="${SPRITE_STYLE}">\n${symbols.join('\n')}\n</svg>`
}

/**
 * Total UTF-8 byte size of every sprite, summed across collections — every inlined
 * sprite ships on every page, so this is the number that actually matters for
 * payload budgeting (not `.length`, which undercounts multi-byte characters).
 */
export function totalSpriteBytes(spriteContents: Map<string, string>): number {
  let total = 0
  for (const content of spriteContents.values()) {
    total += Buffer.byteLength(content, 'utf-8')
  }
  return total
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Called once per icon after buildSprite decides whether it made it into the
 * sprite. Lets callers (module.ts, rebuild.ts) know the actual emitted icon set,
 * which can be a strict subset of the input `icons` — an unreadable, empty,
 * malformed, or non-<svg>-root file is discovered during folder scanning but only
 * rejected here, during content processing. Consumers of collection.icons for
 * generated types/components must use this to avoid advertising an icon (a type
 * union member, a `Use*` component) that doesn't actually exist in any sprite.
 */
export type OnIconResult = (icon: IconMeta, included: boolean) => void

/**
 * Optional cross-call cache, keyed by absolute icon path, letting buildSprite skip
 * re-reading and re-optimizing a file whose mtime hasn't changed since it was last
 * processed. Pointless for a one-shot cold build (every icon is new to the cache),
 * but real HMR rebuilds only touch one or two files while re-scanning the rest of
 * their collection — without this, every keystroke-triggered rebuild of a large flat
 * collection re-reads and re-runs SVGO over every unchanged icon in it too. Callers
 * (module.ts, rebuild.ts) create ONE cache and pass the same instance to every
 * buildSprite/buildAllSprites call for the lifetime of the dev server.
 * `symbol: null` caches a REJECTED icon (edge cases like malformed/non-<svg>-root) —
 * skips re-reading it and re-logging the same error on every unrelated rebuild until
 * the file actually changes.
 */
export interface SymbolCacheEntry {
  mtimeMs: number
  symbol: string | null
}
export type SymbolCache = Map<string, SymbolCacheEntry>

export async function buildAllSprites(
  collections: { name: string, icons: IconMeta[] }[],
  svgoConfig: SvgoConfig | undefined,
  optimizeFiles: boolean,
  logger: SpriteLogger,
  onIconResult?: (collectionName: string, icon: IconMeta, included: boolean) => void,
  cache?: SymbolCache,
  colorOptions?: ColorNormalizationOptions,
  isUsed?: (icon: IconMeta) => boolean,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>()
  await Promise.all(
    collections.map(async (col) => {
      const perIconCallback: OnIconResult | undefined = onIconResult
        ? (icon, included) => onIconResult(col.name, icon, included)
        : undefined
      contents.set(col.name, await buildSprite(col.icons, svgoConfig, optimizeFiles, logger, col.name, perIconCallback, cache, colorOptions, isUsed))
    }),
  )
  return contents
}

export async function buildSprite(
  icons: IconMeta[],
  svgoConfig: SvgoConfig | undefined,
  optimizeFiles: boolean,
  logger: SpriteLogger,
  spriteName = 'default',
  onIconResult?: OnIconResult,
  cache?: SymbolCache,
  colorOptions?: ColorNormalizationOptions,
  // Item #6 (tree-shaking), production builds only (see module.ts). When provided
  // and returns false for an icon, that icon still succeeds processing normally —
  // still cached, still reported to onIconResult as included=true, so generated
  // types/DevTools/Use* components stay unaffected — it is simply excluded from the
  // <symbol> markup THIS call returns. Undefined behaves exactly as before (every
  // icon included) — fully backward compatible.
  isUsed?: (icon: IconMeta) => boolean,
): Promise<string> {
  if (icons.length === 0) {
    logger.warn('No icons found in collection — sprite skipped.')
    return ''
  }

  const symbols: string[] = []
  let succeededCount = 0
  // Built ONCE per buildSprite call — not per icon — so a /g or /y flagged
  // colorOptions.exclude never accumulates lastIndex state across icons.
  const isColorExcluded = makeExcludeMatcher(colorOptions?.exclude)

  // Read every icon file concurrently (I/O-bound, independent of each other) instead
  // of one at a time — Promise.all preserves array order regardless of completion
  // order, so the rest of the per-icon processing below stays sequential/ordered.
  // A cache hit (mtime unchanged since last processed) skips the read entirely.
  type ReadResult
    = { icon: IconMeta, kind: 'error' }
      | { icon: IconMeta, kind: 'cached', entry: SymbolCacheEntry }
      | { icon: IconMeta, kind: 'fresh', raw: string, mtimeMs: number }

  const reads: ReadResult[] = await Promise.all(icons.map(async (icon): Promise<ReadResult> => {
    try {
      const stat = await fsp.stat(icon.absolutePath)
      const cached = cache?.get(icon.absolutePath)
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return { icon, kind: 'cached', entry: cached }
      }
      const raw = await fsp.readFile(icon.absolutePath, 'utf-8')
      return { icon, kind: 'fresh', raw, mtimeMs: stat.mtimeMs }
    }
    catch (err) {
      logger.error(`Failed to read "${icon.absolutePath}": ${String(err)} — skipping.`)
      return { icon, kind: 'error' }
    }
  }))

  for (const result of reads) {
    const { icon } = result

    if (result.kind === 'error') {
      onIconResult?.(icon, false)
      continue
    }

    if (result.kind === 'cached') {
      if (result.entry.symbol !== null) {
        succeededCount++
        if (isUsed === undefined || isUsed(icon)) symbols.push(result.entry.symbol)
        onIconResult?.(icon, true)
      }
      else {
        onIconResult?.(icon, false)
      }
      continue
    }

    const { raw, mtimeMs } = result

    if (raw.trim() === '') {
      logger.error(`"${icon.absolutePath}" is empty — skipping.`)
      cache?.set(icon.absolutePath, { mtimeMs, symbol: null })
      onIconResult?.(icon, false)
      continue
    }

    // Reject files that already contain <symbol> elements — merging one sprite into
    // another produces a broken nested <symbol> (checked with comments stripped, so
    // "<!-- <symbol> -->" isn't a false positive).
    if (HAS_SYMBOL_RE.test(raw.replace(COMMENT_RE, ''))) {
      logger.error(`"${icon.absolutePath}" contains <symbol> elements and cannot be used as an icon — skipping.`)
      cache?.set(icon.absolutePath, { mtimeMs, symbol: null })
      onIconResult?.(icon, false)
      continue
    }

    // Synthesize viewBox from width/height if missing; note whether it was already
    // present so the "no viewBox or dimensions" warning below can be deferred until
    // we know the icon actually made it into the sprite (optimize() can still reject
    // it afterward, and warning "included as-is" about something that got excluded
    // would be misleading).
    const hasViewBox = /\bviewBox\s*=/.test(raw)
    const input = ensureViewBox(raw)
    const missingDimensions = !hasViewBox && input === raw

    const shouldNormalizeColors = colorOptions?.normalize === true && !isColorExcluded(icon.id)
    const config = buildIconConfig(svgoConfig, spriteName, icon, optimizeFiles, shouldNormalizeColors)
    // Only meaningful on the raw path — on the optimized path inlineStyles already
    // removes <style> blocks entirely, so there is nothing left to leak.
    const skipsOptimization = !optimizeFiles || icon.raw === true
    const unscopedStyle = skipsOptimization && hasUnscopedStyleSelector(raw)
    try {
      const optimized = optimize(input, config)
      // convertToSymbol only renames a root <svg> — if the source's root element
      // wasn't <svg> (or optimize somehow produced nothing), the result never became
      // a <symbol>. Emitting it verbatim would silently corrupt the sprite.
      if (!/^\s*<symbol[\s/>]/.test(optimized.data)) {
        logger.error(`"${icon.absolutePath}" does not have an <svg> root element — skipping.`)
        cache?.set(icon.absolutePath, { mtimeMs, symbol: null })
        onIconResult?.(icon, false)
        continue
      }
      if (missingDimensions) {
        logger.warn(`"${icon.absolutePath}" has no viewBox or dimensions — included as-is, may not scale correctly.`)
      }
      if (unscopedStyle) {
        logger.warn(
          `"${icon.absolutePath}" has a <style> rule with no class selector — on the raw/`
          + `optimizeFiles:false path it is not scoped to this icon and will apply page-wide `
          + `once the sprite is inlined. Scope the rule to a class (SVGO will prefix it `
          + `automatically), or remove the <style> block.`,
        )
      }
      succeededCount++
      if (isUsed === undefined || isUsed(icon)) symbols.push(optimized.data)
      cache?.set(icon.absolutePath, { mtimeMs, symbol: optimized.data })
      onIconResult?.(icon, true)
    }
    catch (err) {
      // Malformed SVG — log and skip, do not fail the whole sprite.
      logger.error(`Failed to process "${icon.absolutePath}": ${String(err)} — skipping.`)
      cache?.set(icon.absolutePath, { mtimeMs, symbol: null })
      onIconResult?.(icon, false)
    }
  }

  if (symbols.length === 0) {
    // Same empty-sprite shape either way — the generated Sprite.vue template already
    // handles it via `spriteContents.get(name) ?? ''` — but the REASON differs:
    // distinguish "every icon failed processing" (a real problem, already logged
    // per-icon above) from "every icon was tree-shaken out" (expected, not an error).
    if (succeededCount > 0) {
      logger.info(`All ${succeededCount} icon(s) in this collection were tree-shaken out (not detected as used) — sprite is empty.`)
    }
    else {
      logger.warn(`All ${icons.length} icon(s) in this collection failed to process — sprite is empty.`)
    }
    return ''
  }

  return buildSpriteWrapper(symbols)
}
