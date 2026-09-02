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

/**
 * PascalCase/camelCase → kebab-case ("UseAdminStar" → "use-admin-star"). Byte-for-
 * byte Vue's own `hyphenate` (`@vue/shared`) — the exact transform Vue/Nuxt use to
 * resolve a kebab-case template tag back to a registered PascalCase component, so
 * matching it here (usage-scanner.ts) guarantees recognizing precisely the
 * kebab forms that actually render, no more and no less.
 */
export function toKebabCase(str: string): string {
  return str.replace(/\B([A-Z])/g, '-$1').toLowerCase()
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
 * True when `prefix` contains only identifier-PART characters (letters, digits,
 * `_`, `$`) — the character class valid ANYWHERE in a JS identifier, not just its
 * first position. Deliberately NOT the stricter "valid identifier start" rule
 * (`/^[A-Za-z_$][\w$]*$/`): a leading digit (e.g. `'2fa'`) is already repaired one
 * layer down by `ensureValidIdentifierStart` on the COMBINED name, so rejecting it
 * here would break a prefix that actually works today. `''` (empty prefix) is
 * accepted too — a deliberately supported, already-safe value.
 */
export function isValidComponentPrefix(prefix: string): boolean {
  return /^[\w$]*$/.test(prefix)
}

/**
 * `componentPrefix` feeds `buildIconMeta`'s `export const ${componentName} =` line
 * (templates.ts) as a literal JS identifier — an invalid prefix like `'icon-'` or
 * `'My Icon'` (both otherwise-plausible choices, since hyphens/spaces work fine for
 * `id`/collection-name derivation elsewhere in this module) would produce a
 * syntactically broken generated file. Nothing `import`s that file directly (only
 * `@nuxt/kit`'s `addComponentExports`, via its own export-name resolution), so the
 * failure mode is silent: zero working `Use*` components and, if a user then
 * references one, an unattributable Vite parse error naming no file — hence
 * validating up front. Called ONCE at setup time (module.ts), before any icon meta
 * is derived from it — not per-icon, since it's a single config value.
 */
export function resolveComponentPrefix(prefix: string, logger: { warn(msg: string): void }): string {
  if (isValidComponentPrefix(prefix)) return prefix
  logger.warn(
    `componentPrefix "${prefix}" contains characters that are not valid in a JavaScript identifier, `
    + `which would produce a syntactically broken generated component file. Falling back to "Use". `
    + `Use a PascalCase prefix instead — componentPrefix: 'Icon' gives <IconHome /> (and the kebab form `
    + `<icon-home />, which Nuxt auto-imports too).`,
  )
  return 'Use'
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
