import SVGSprite, { type Config as SpriteConfig } from 'svg-sprite'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { IconMeta } from '../types/types'

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function prefixInternalIds(svg: string, prefix: string): string {
  const ids = new Set<string>()
  for (const m of svg.matchAll(/\bid="([^"]*)"/g)) ids.add(m[1]!)
  if (ids.size === 0) return svg
  let out = svg.replace(/\bid="([^"]*)"/g, (_, id: string) => `id="${prefix}-${id}"`)
  out = out.replace(/url\(#([^)]+)\)/g, (_, ref: string) =>
    ids.has(ref) ? `url(#${prefix}-${ref})` : `url(#${ref})`,
  )
  out = out.replace(/(xlink:href|href)="#([^"]*)"/g, (_, attr: string, ref: string) =>
    ids.has(ref) ? `${attr}="#${prefix}-${ref}"` : `${attr}="#${ref}"`,
  )
  return out
}

export interface SpriteLogger {
  error(msg: string): void
  warn(msg: string): void
  info(msg: string): void
}

export const defaultSpriteConfig: SpriteConfig = {
  mode: {
    symbol: {
      render: { css: false, scss: false },
      example: false,
    },
  },
  shape: {
    transform: ['svgo'],
  },
  svg: {
    xmlDeclaration: false,
    rootAttributes: {
      'aria-hidden': 'true',
      'style': 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;',
    },
  },
}

/**
 * Returns a copy of spriteOptions with the SVGO transform disabled.
 * Uses nested spread so that other shape keys are preserved.
 * When optimizeFiles is true, the original object is returned as-is.
 */
export function buildSpriteConfig(spriteOptions: SpriteConfig, optimizeFiles: boolean): SpriteConfig {
  if (optimizeFiles) return spriteOptions
  return {
    ...spriteOptions,
    shape: {
      ...spriteOptions.shape,
      transform: [],
    },
  }
}

/**
 * Reads the SVG sprite string from svg-sprite's compile result.
 * Returns an empty string and logs an error if the result is malformed.
 */
export function extractSprite(result: unknown, logger: Pick<SpriteLogger, 'error'>): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents = (result as any)?.symbol?.sprite?.contents?.toString()
  if (!contents) {
    logger.error('Failed to extract sprite from svg-sprite result. Check your spriteOptions.')
    return ''
  }
  return contents
}

/**
 * Builds sprite content for every collection in parallel.
 */
export async function buildAllSprites(
  collections: { name: string, icons: IconMeta[] }[],
  spriteOptions: SpriteConfig,
  optimizeFiles: boolean,
  logger: SpriteLogger,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>()
  await Promise.all(
    collections.map(async col =>
      contents.set(col.name, await buildSprite(col.icons, spriteOptions, optimizeFiles, logger)),
    ),
  )
  return contents
}

/**
 * Merges two compiled sprite strings by extracting `<symbol>` elements from
 * `secondary` and appending them to `primary` before the closing `</svg>`.
 * Exported for unit testing.
 */
export function mergeSprites(primary: string, secondary: string): string {
  if (!primary) return secondary
  if (!secondary) return primary
  const symbols = secondary.match(/<symbol[\s\S]*?<\/symbol>/g) ?? []
  if (symbols.length === 0) return primary
  return primary.replace('</svg>', `${symbols.join('\n')}\n</svg>`)
}

async function compileSpriteFromIcons(
  icons: IconMeta[],
  spriteOptions: SpriteConfig,
  optimizeFiles: boolean,
  logger: SpriteLogger,
): Promise<string> {
  const config = buildSpriteConfig(spriteOptions, optimizeFiles)
  const spriter = new SVGSprite(config)

  for (const icon of icons) {
    const raw = await fsp.readFile(icon.absolutePath, 'utf-8')
    const virtualPath = path.join(path.dirname(icon.absolutePath), `${icon.id}.svg`)
    const content = prefixInternalIds(raw, `i${hashCode(virtualPath)}`)
    spriter.add(virtualPath, null, content)
  }

  const { result } = await spriter.compileAsync()
  return extractSprite(result, logger)
}

/**
 * Compiles an SVG sprite from the given icons.
 * Uses icon.id as the symbol id so that collection-prefixed ids (e.g. "admin-star")
 * are preserved regardless of the actual filename.
 * Icons flagged with `raw: true` (*.raw.svg files) skip SVGO optimization.
 */
export async function buildSprite(
  icons: IconMeta[],
  spriteOptions: SpriteConfig,
  optimizeFiles: boolean,
  logger: SpriteLogger,
): Promise<string> {
  if (icons.length === 0) {
    logger.warn('No icons found in collection — sprite skipped.')
    return ''
  }

  const rawIcons = icons.filter(i => i.raw)

  if (rawIcons.length === 0) {
    return compileSpriteFromIcons(icons, spriteOptions, optimizeFiles, logger)
  }

  const normalIcons = icons.filter(i => !i.raw)
  const normalPart = normalIcons.length > 0
    ? await compileSpriteFromIcons(normalIcons, spriteOptions, optimizeFiles, logger)
    : ''
  const rawPart = await compileSpriteFromIcons(rawIcons, spriteOptions, false, logger)

  return mergeSprites(normalPart, rawPart)
}
