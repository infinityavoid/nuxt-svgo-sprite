import path from 'node:path'
import { walkInputDir, readDirectSvgFiles } from '../utils/fs'
import {
  buildIconMeta,
  deriveCollectionName,
  deriveTypeName,
  deriveSpriteComponentName,
  sanitizeSegment,
  sanitizeFilename,
} from '../utils/icon-meta'
import type { SpriteCollection, IconMeta } from '../types/types'

export interface CollectionLogger {
  warn(msg: string): void
}

/**
 * Resolves the sanitized filename base for `filename` (accounting for `.raw.svg`),
 * warning when normalization changed it. Returns undefined (and warns) when the base
 * has no usable characters after normalization — e.g. a filename with no ASCII
 * alphanumerics (extends the ADR-014 sanitization-warning policy to filenames, not
 * just folder segments).
 */
function resolveFilenameBase(
  filename: string,
  collectionLabel: string,
  logger: CollectionLogger,
): string | undefined {
  const isRaw = /\.raw\.svg$/i.test(filename)
  const effectiveName = isRaw ? filename.slice(0, -8) + '.svg' : filename
  const base = sanitizeFilename(effectiveName)

  if (!base) {
    logger.warn(
      `Skipping "${filename}" in collection "${collectionLabel}": filename has no usable characters after normalization.`,
    )
    return undefined
  }

  const rawBase = effectiveName.slice(0, -4).toLowerCase()
  if (rawBase !== base) {
    logger.warn(
      `Filename "${filename}" contains non-standard characters and was normalized (original base: "${rawBase}").`,
    )
  }

  return base
}

/**
 * Builds IconMeta for every file in `files`, applying filename-sanitization and
 * within-collection id-collision guards. Single place both `buildCollectionsFromDir`
 * and `rebuildSingleCollection` derive icons from files, so the two never drift.
 */
function processFiles(
  files: string[],
  segments: string[],
  collectionLabel: string,
  componentPrefix: string,
  logger: CollectionLogger,
): IconMeta[] {
  const seenIds = new Set<string>()
  const icons: IconMeta[] = []

  for (const filePath of files) {
    const filename = path.basename(filePath)

    if (resolveFilenameBase(filename, collectionLabel, logger) === undefined) continue

    const meta = buildIconMeta(filename, segments, filePath, componentPrefix)

    if (seenIds.has(meta.id)) {
      logger.warn(
        `Id collision in collection "${collectionLabel}": "${meta.id}" already exists. Skipping "${filename}".`,
      )
      continue
    }

    seenIds.add(meta.id)
    icons.push(meta)
  }

  return icons
}

/**
 * Walks resolvedInputDir and builds one SpriteCollection per discovered folder.
 * Root-level and default/ SVGs → default collection.
 * Each other subfolder (at any depth) → its own named collection.
 * Collections with no icons after collision filtering are omitted.
 *
 * After discovery, two global validation passes run across ALL collections:
 * collection-name uniqueness (two folders sanitizing to the same name, e.g.
 * "admin-icons" and "admin_icons") and symbol-id uniqueness (e.g. "admin/star.svg"
 * and root-level "admin-star.svg" both deriving id "admin-star"). Both are
 * warn-and-skip-the-later-one, matching the within-collection collision policy.
 *
 * No Nuxt dependency — path resolution is the caller's responsibility.
 */
export async function buildCollectionsFromDir(
  resolvedInputDir: string,
  componentPrefix: string,
  logger: CollectionLogger,
): Promise<SpriteCollection[]> {
  const entries = await walkInputDir(resolvedInputDir, logger)
  const candidates: { collection: SpriteCollection, rawPath: string }[] = []

  for (const entry of entries) {
    const { segments, files } = entry

    // Sanitize folder-name segments; skip the entire entry if any segment
    // has no usable characters after normalization (e.g. a folder named "@@@").
    const sanitizedSegments = segments.map(sanitizeSegment)
    const badSegment = segments.find((_, i) => !sanitizedSegments[i])
    if (badSegment !== undefined) {
      logger.warn(
        `Skipping collection: folder segment "${badSegment}" cannot be normalized to a valid identifier.`,
      )
      continue
    }

    const name = deriveCollectionName(sanitizedSegments)
    const icons = processFiles(files, sanitizedSegments, name, componentPrefix, logger)
    if (icons.length === 0) continue

    // Default collection (segments []) → inputDir is the tree root. Named
    // collections → derive inputDir from an actual file's real path, not by
    // rejoining `segments` onto the root: walkInputDir strips a leading `default`
    // segment for NAMING purposes (e.g. `default/nested/x.svg` → segments
    // `['nested']`), but the file's real directory still physically contains
    // `default/` — rejoining `segments` alone would point at a directory that
    // doesn't exist (`<root>/nested` instead of `<root>/default/nested`), which
    // then made the watcher/rebuild path unable to ever find these files again.
    const collectionDir = segments.length === 0
      ? resolvedInputDir
      : path.dirname(files[0]!)

    candidates.push({
      collection: {
        name,
        segments: sanitizedSegments.slice(),
        inputDir: collectionDir,
        spriteComponentName: deriveSpriteComponentName(name),
        typeName: deriveTypeName(name),
        icons,
      },
      rawPath: segments.length === 0 ? '(root)' : segments.join('/'),
    })
  }

  // Global pass 1: collection-name uniqueness across the whole tree. The root
  // ("(root)", segments []) always wins a collision — it can't be "renamed" to
  // resolve one the way a real subfolder can, and silently dropping every
  // root-level icon is a worse outcome than dropping a named subfolder's icons.
  candidates.sort((a, b) => (a.rawPath === '(root)' ? -1 : b.rawPath === '(root)' ? 1 : 0))
  const seenNames = new Map<string, string>()
  const named: { collection: SpriteCollection, rawPath: string }[] = []
  for (const candidate of candidates) {
    const existingPath = seenNames.get(candidate.collection.name)
    if (existingPath !== undefined) {
      logger.warn(
        `Collection name collision: folder "${candidate.rawPath}" normalizes to the same collection `
        + `name ("${candidate.collection.name}") as folder "${existingPath}". Rename "${candidate.rawPath}" `
        + `to resolve this — its icons are excluded until you do.`,
      )
      continue
    }
    seenNames.set(candidate.collection.name, candidate.rawPath)
    named.push(candidate)
  }

  // Global pass 2: symbol-id uniqueness across the whole tree (ADR-015's "unique by
  // construction" claim doesn't hold in general — e.g. "admin/star.svg" and root-level
  // "admin-star.svg" both derive id "admin-star").
  const seenIds = new Set<string>()
  const collections: SpriteCollection[] = []
  for (const { collection } of named) {
    const icons = collection.icons.filter((icon) => {
      if (seenIds.has(icon.id)) {
        logger.warn(
          `Symbol id collision: "${icon.id}" in collection "${collection.name}" was already used by another `
          + `collection. Skipping "${icon.absolutePath}" — rename the file or its folder.`,
        )
        return false
      }
      seenIds.add(icon.id)
      return true
    })
    if (icons.length > 0) collections.push({ ...collection, icons })
  }

  return collections
}

/**
 * Re-scans a single collection's folder and returns an updated SpriteCollection.
 * Used by the watcher rebuild path to avoid re-scanning the entire inputDir tree.
 * Cross-collection id uniqueness (global pass 2 above) is re-checked by the caller
 * against the other live collections — this function only re-derives the local set.
 *
 * Reads `collection.inputDir` directly (one level, no recursion) rather than reusing
 * `walkInputDir` — that walker's `default/`-prefix-stripping rule is only correct
 * relative to the TRUE inputDir root; applying it to an arbitrary collection subtree
 * would misclassify a nested folder that happens to be named "default" (e.g.
 * `<inputDir>/admin/default/x.svg` rescanned from `admin/` would wrongly look like a
 * direct file of `admin` instead of the separate `adminDefault` collection a cold
 * build assigns it to).
 */
export async function rebuildSingleCollection(
  collection: SpriteCollection,
  componentPrefix: string,
  logger: CollectionLogger,
): Promise<SpriteCollection> {
  const direct = await readDirectSvgFiles(collection.inputDir, logger)
  // The default collection also merges direct files from an inputDir/default/
  // subfolder (see utils/fs.ts's walkInputDir merge rule) — mirror that here. No
  // logger passed: that subfolder not existing is the normal case, not a warning.
  const files = collection.segments.length === 0
    ? [...direct, ...(await readDirectSvgFiles(path.join(collection.inputDir, 'default')))].sort()
    : direct

  const icons = processFiles(files, collection.segments, collection.name, componentPrefix, logger)

  return { ...collection, icons }
}
