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

// Attribute allowlist for <symbol> elements (ported from svg-sprite/lib/svg-sprite/mode/symbol.js)
const SYMBOL_ATTRIBUTES = new Set([
  'id',
  'xml:base', 'xml:lang', 'xml:space',
  'onfocusin', 'onfocusout', 'onactivate', 'onclick',
  'onmousedown', 'onmouseup', 'onmouseover', 'onmousemove', 'onmouseout', 'onload',
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

// Regex to detect files that are already sprites (contain <symbol>)
const HAS_SYMBOL_RE = /<symbol[\s\S]*?>/i

export interface SpriteLogger {
  error(msg: string): void
  warn(msg: string): void
  info(msg: string): void
}

// ─── Default SVGO config ──────────────────────────────────────────────────────

export const defaultSvgoConfig: SvgoConfig = {
  plugins: [
    'preset-default',
    { name: 'inlineStyles', params: { onlyMatchedOnce: false } },
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

// ─── Config builder ───────────────────────────────────────────────────────────

function iconIdPrefix(spriteName: string, iconId: string): string {
  const safe = iconId.replace(/[^a-z0-9]/gi, '_')
  return `${spriteName}__${safe}__`
}

function buildIconConfig(
  baseCfg: SvgoConfig,
  spriteName: string,
  icon: IconMeta,
  optimizeFiles: boolean,
): SvgoConfig {
  const skipOptimization = !optimizeFiles || icon.raw === true
  const basePlugins = skipOptimization ? [] : (baseCfg.plugins ?? [])
  return {
    plugins: [
      ...basePlugins,
      makeInlineDefsPlugin(),
      { name: 'prefixIds', params: { prefix: iconIdPrefix(spriteName, icon.id), delim: '' } },
      makeConvertToSymbolPlugin(icon.id),
    ] as SvgoConfig['plugins'],
  }
}

// ─── View box fallback ────────────────────────────────────────────────────────

// Synthesizes viewBox from width/height when viewBox is absent (edge case 9).
function ensureViewBox(svg: string): string {
  if (/\bviewBox\s*=/.test(svg)) return svg
  const w = svg.match(/<svg[^>]*\swidth\s*=\s*["']([0-9.]+)["']/)?.[1]
  const h = svg.match(/<svg[^>]*\sheight\s*=\s*["']([0-9.]+)["']/)?.[1]
  if (w && h) {
    return svg.replace(/(<svg\b)/, `$1 viewBox="0 0 ${w} ${h}"`)
  }
  return svg
}

// ─── Sprite assembly ──────────────────────────────────────────────────────────

function buildSpriteWrapper(symbols: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="${SPRITE_STYLE}">\n${symbols.join('\n')}\n</svg>`
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function buildAllSprites(
  collections: { name: string, icons: IconMeta[] }[],
  svgoConfig: SvgoConfig,
  optimizeFiles: boolean,
  logger: SpriteLogger,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>()
  await Promise.all(
    collections.map(async col =>
      contents.set(col.name, await buildSprite(col.icons, svgoConfig, optimizeFiles, logger, col.name)),
    ),
  )
  return contents
}

export async function buildSprite(
  icons: IconMeta[],
  svgoConfig: SvgoConfig,
  optimizeFiles: boolean,
  logger: SpriteLogger,
  spriteName = 'default',
): Promise<string> {
  if (icons.length === 0) {
    logger.warn('No icons found in collection — sprite skipped.')
    return ''
  }

  const symbols: string[] = []

  for (const icon of icons) {
    let raw: string
    try {
      raw = await fsp.readFile(icon.absolutePath, 'utf-8')
    }
    catch (err) {
      logger.error(`Failed to read "${icon.absolutePath}": ${String(err)} — skipping.`)
      continue
    }

    // Edge case 15: reject files that already contain <symbol> elements
    if (HAS_SYMBOL_RE.test(raw)) {
      logger.error(`"${icon.absolutePath}" contains <symbol> elements and cannot be used as an icon — skipping.`)
      continue
    }

    // Edge case 9: synthesize viewBox from width/height if missing
    const hasViewBox = /\bviewBox\s*=/.test(raw)
    const input = ensureViewBox(raw)
    if (!hasViewBox && input === raw) {
      // ensureViewBox returned unchanged — no viewBox, no parseable dimensions
      logger.warn(`"${icon.absolutePath}" has no viewBox or dimensions — included as-is, may not scale correctly.`)
    }

    const config = buildIconConfig(svgoConfig, spriteName, icon, optimizeFiles)
    try {
      const result = optimize(input, config)
      symbols.push(result.data)
    }
    catch (err) {
      // Edge case 8: malformed SVG — log and skip, do not fail the whole sprite
      logger.error(`Failed to process "${icon.absolutePath}": ${String(err)} — skipping.`)
    }
  }

  return buildSpriteWrapper(symbols)
}
