import SVGSprite, { type Config as SpriteConfig } from 'svg-sprite'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { IconMeta } from '../types/types'

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
 * Compiles an SVG sprite from the given icons.
 * Uses icon.id as the symbol id so that collection-prefixed ids (e.g. "admin-star")
 * are preserved regardless of the actual filename.
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

  const config = buildSpriteConfig(spriteOptions, optimizeFiles)
  const spriter = new SVGSprite(config)

  for (const icon of icons) {
    const content = await fsp.readFile(icon.absolutePath, 'utf-8')
    // Use a virtual file path with icon.id as the basename so svg-sprite derives our
    // computed id as the symbol id, regardless of the actual filename on disk.
    // svg-sprite uses the file path only for id derivation; the content comes from `content`.
    const virtualPath = path.join(path.dirname(icon.absolutePath), `${icon.id}.svg`)
    spriter.add(virtualPath, null, content)
  }

  const { result } = await spriter.compileAsync()
  return extractSprite(result, logger)
}
