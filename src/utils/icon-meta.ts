import type { IconMeta } from '../types/types'

/**
 * Normalizes a single folder-path segment to a valid id fragment:
 * lowercase, replace non-letter/digit/hyphen chars with hyphens,
 * collapse consecutive hyphens, trim leading/trailing hyphens.
 * Returns an empty string when the input has no usable characters.
 */
export function sanitizeSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Strips .svg extension, lowercases, replaces non-letter/digit/hyphen chars
 * with hyphens, collapses consecutive hyphens, trims leading/trailing hyphens.
 */
export function sanitizeFilename(filename: string): string {
  const withoutExt = /\.svg$/i.test(filename) ? filename.slice(0, -4) : filename
  return withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Splits on hyphens, capitalizes each part, joins — the only place this logic lives.
 * Works on both hyphen-separated ids ("admin-star" → "AdminStar") and camelCase
 * collection names ("adminButtons" → "AdminButtons").
 */
export function toPascalCase(str: string): string {
  return str
    .split('-')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/**
 * Prepends an underscore when `str` doesn't start with a valid identifier-start
 * character (letter, `_`, or `$`) — e.g. a folder named "2fa" would otherwise derive
 * a type name like "2faIconName", which is not valid TypeScript/JS syntax.
 */
function ensureValidIdentifierStart(str: string): string {
  return /^[a-z_$]/i.test(str) ? str : `_${str}`
}

/**
 * Derives the camelCase collection name from folder path segments.
 * Empty segments → "default".
 */
export function deriveCollectionName(segments: string[]): string {
  if (segments.length === 0) return 'default'
  return toCamelCase(segments.join('-'))
}

/**
 * Derives the TypeScript type name for a collection.
 * Uses the uniform formula for all collections, including default → DefaultIconName.
 */
export function deriveTypeName(collectionName: string): string {
  return ensureValidIdentifierStart(toPascalCase(collectionName)) + 'IconName'
}

/**
 * Derives the sprite component name for a collection.
 * Uniform formula for all collections: PascalCase(name) + "Sprite".
 * Examples: default → DefaultSprite, admin → AdminSprite.
 */
export function deriveSpriteComponentName(collectionName: string): string {
  return ensureValidIdentifierStart(toPascalCase(collectionName)) + 'Sprite'
}

/**
 * Single source of truth for icon identity.
 * Maps (filename, segments, absoluteFilePath, componentPrefix) → IconMeta.
 * No other code may derive ids or component names.
 */
export function buildIconMeta(
  filename: string,
  segments: string[],
  absoluteFilePath: string,
  componentPrefix: string,
): IconMeta {
  const isRaw = /\.raw\.svg$/i.test(filename)
  // Strip .raw before .svg so the icon id is 'home', not 'home-raw'
  const effectiveName = isRaw ? filename.slice(0, -8) + '.svg' : filename
  const base = sanitizeFilename(effectiveName)
  const id = segments.length === 0 ? base : `${segments.join('-')}-${base}`
  const componentName = ensureValidIdentifierStart(componentPrefix + toPascalCase(id))
  return { id, componentName, absolutePath: absoluteFilePath, raw: isRaw || undefined }
}
