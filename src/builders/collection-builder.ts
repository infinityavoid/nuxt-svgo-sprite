import path from 'node:path'
import { walkInputDir, readDirectSvgFiles, type IsIgnored } from '../utils/fs'
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

export interface CollectionRoot {
  /** Absolute directory to walk. */
  dir: string
  /** Human-readable origin used in warnings; '(root)' for the app's own inputDir. */
  label: string
}

/**
 * Prefixes a folder's rawPath with its root's label, except for the app's own root
 * (label '(root)'), which keeps today's unprefixed wording unchanged.
 */
function describeRawPath(root: CollectionRoot, segments: string[]): string {
  const local = segments.length === 0 ? '(root)' : segments.join('/')
  if (root.label === '(root)') return local
  return segments.length === 0 ? root.label : `${root.label}:${local}`
}

/**
 * Walks resolvedInputDir (or, when passed an array, every Nuxt-layer root in
 * priority order — see resolveLayerInputDirs) and builds one SpriteCollection per
 * discovered folder. Root-level and default/ SVGs → default collection. Each other
 * subfolder (at any depth) → its own named collection. Collections with no icons
 * after collision filtering are omitted.
 *
 * Each root is first resolved independently: a collection-name collision between two
 * folders WITHIN one root's own tree (e.g. "admin-icons" and "admin_icons") is
 * warn-and-skip-the-later-one, exactly as before — almost always a real mistake, not
 * a merge request. The root's own default/named-root collection always wins such an
 * intra-root collision (it can't be "renamed" to resolve one the way a real subfolder
 * can).
 *
 * Roots are then merged: a collection name present in more than one root (e.g. the
 * app's own `admin/` and a layer's `admin/`) has its icons concatenated rather than
 * dropped — that IS the layer-merging feature. A final symbol-id uniqueness pass runs
 * across the merged set, in root-priority order, so a higher-priority root's icon
 * always wins an id collision (ADR-015's "unique by construction" claim doesn't hold
 * in general — e.g. "admin/star.svg" and root-level "admin-star.svg" both derive id
 * "admin-star", and now also a layer's "admin/star.svg" vs. the app's own).
 *
 * A merged collection's `inputDir` is its highest-priority contributing root's real
 * directory — HMR (setupWatcher/rebuildSingleCollection) only ever re-scans that one
 * directory, so editing a LOWER-priority layer's icons requires a dev server restart
 * to pick up (same documented limitation as adding a brand new collection folder).
 *
 * No Nuxt dependency — path resolution is the caller's responsibility.
 */
export async function buildCollectionsFromDir(
  input: string | CollectionRoot[],
  componentPrefix: string,
  logger: CollectionLogger,
  isIgnored?: IsIgnored,
): Promise<SpriteCollection[]> {
  const roots: CollectionRoot[] = typeof input === 'string' ? [{ dir: input, label: '(root)' }] : input

  const perRoot: { name: string, collection: SpriteCollection }[][] = []

  for (const root of roots) {
    const entries = await walkInputDir(root.dir, logger, isIgnored)
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

      // Default collection (segments []) → inputDir is this root's tree root. Named
      // collections → derive inputDir from an actual file's real path, not by
      // rejoining `segments` onto the root: walkInputDir strips a leading `default`
      // segment for NAMING purposes (e.g. `default/nested/x.svg` → segments
      // `['nested']`), but the file's real directory still physically contains
      // `default/` — rejoining `segments` alone would point at a directory that
      // doesn't exist (`<root>/nested` instead of `<root>/default/nested`), which
      // then made the watcher/rebuild path unable to ever find these files again.
      const collectionDir = segments.length === 0
        ? root.dir
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
        rawPath: describeRawPath(root, segments),
      })
    }

    // Intra-root pass: collection-name uniqueness within THIS root's own tree. The
    // root's own default/root collection ("(root)" or this root's label) always wins
    // — it can't be "renamed" to resolve one the way a real subfolder can, and
    // silently dropping every root-level icon is a worse outcome than dropping a
    // named subfolder's icons.
    candidates.sort((a, b) => (a.rawPath === root.label ? -1 : b.rawPath === root.label ? 1 : 0))
    const seenNames = new Map<string, string>()
    const named: { name: string, collection: SpriteCollection }[] = []
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
      named.push({ name: candidate.collection.name, collection: candidate.collection })
    }

    perRoot.push(named)
  }

  // Cross-root merge: a collection name seen in more than one root has its icons
  // concatenated (in root-priority order — roots[0] is highest priority), keeping the
  // first (highest-priority) root's metadata/inputDir.
  const merged = new Map<string, SpriteCollection>()
  for (const rootResult of perRoot) {
    for (const { name, collection } of rootResult) {
      const existing = merged.get(name)
      merged.set(name, existing ? { ...existing, icons: [...existing.icons, ...collection.icons] } : collection)
    }
  }

  // Final pass: symbol-id uniqueness across the merged set, in root-priority order.
  const seenIds = new Set<string>()
  const collections: SpriteCollection[] = []
  for (const collection of merged.values()) {
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
  isIgnored?: IsIgnored,
): Promise<SpriteCollection> {
  const direct = await readDirectSvgFiles(collection.inputDir, logger, isIgnored)
  // The default collection also merges direct files from an inputDir/default/
  // subfolder (see utils/fs.ts's walkInputDir merge rule) — mirror that here. No
  // logger passed: that subfolder not existing is the normal case, not a warning.
  const files = collection.segments.length === 0
    ? [...direct, ...(await readDirectSvgFiles(path.join(collection.inputDir, 'default'), undefined, isIgnored))].sort()
    : direct

  const icons = processFiles(files, collection.segments, collection.name, componentPrefix, logger)

  return { ...collection, icons }
}
