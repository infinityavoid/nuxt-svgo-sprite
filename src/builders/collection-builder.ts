import path from 'node:path'
import { walkInputDir } from '../utils/fs'
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
 * Walks resolvedInputDir and builds one SpriteCollection per discovered folder.
 * Root-level and default/ SVGs → default collection.
 * Each other subfolder (at any depth) → its own named collection.
 * Collections with no icons after collision filtering are omitted.
 *
 * No Nuxt dependency — path resolution is the caller's responsibility.
 */
export async function buildCollectionsFromDir(
  resolvedInputDir: string,
  componentPrefix: string,
  logger: CollectionLogger,
): Promise<SpriteCollection[]> {
  const entries = await walkInputDir(resolvedInputDir, logger)
  const collections: SpriteCollection[] = []

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

    const seenIds = new Set<string>()
    const icons: IconMeta[] = []

    for (const filePath of files) {
      const filename = path.basename(filePath)

      // Warn when the filename needs sanitization beyond just removing the extension.
      const effectiveName = filename.endsWith('.raw.svg') ? filename.slice(0, -8) + '.svg' : filename
      const rawBase = effectiveName.slice(0, -4).toLowerCase()
      if (rawBase !== sanitizeFilename(effectiveName)) {
        logger.warn(
          `Filename "${filename}" contains non-standard characters and was normalized (original base: "${rawBase}").`,
        )
      }

      const meta = buildIconMeta(filename, sanitizedSegments, filePath, componentPrefix)

      if (seenIds.has(meta.id)) {
        logger.warn(
          `Id collision in collection "${name}": "${meta.id}" already exists. Skipping "${filename}".`,
        )
        continue
      }

      seenIds.add(meta.id)
      icons.push(meta)
    }

    if (icons.length === 0) continue

    // Default collection (segments []) → inputDir is the tree root.
    // Named collections → inputDir uses the original (filesystem) segments.
    const collectionDir = segments.length === 0
      ? resolvedInputDir
      : path.join(resolvedInputDir, ...segments)

    collections.push({
      name,
      segments: sanitizedSegments.slice(),
      inputDir: collectionDir,
      spriteComponentName: deriveSpriteComponentName(name),
      typeName: deriveTypeName(name),
      icons,
    })
  }

  return collections
}

/**
 * Re-scans a single collection's folder and returns an updated SpriteCollection.
 * Used by the watcher rebuild path to avoid re-scanning the entire inputDir tree.
 */
export async function rebuildSingleCollection(
  collection: SpriteCollection,
  componentPrefix: string,
  logger: CollectionLogger,
): Promise<SpriteCollection> {
  const entries = await walkInputDir(collection.inputDir, logger)
  const direct = entries.find(e => e.segments.length === 0)
  const files = direct?.files ?? []

  const seenIds = new Set<string>()
  const icons: IconMeta[] = []

  for (const filePath of files) {
    const filename = path.basename(filePath)
    const meta = buildIconMeta(filename, collection.segments, filePath, componentPrefix)

    if (seenIds.has(meta.id)) {
      logger.warn(
        `Id collision in collection "${collection.name}": "${meta.id}" already exists. Skipping "${filename}".`,
      )
      continue
    }

    seenIds.add(meta.id)
    icons.push(meta)
  }

  return { ...collection, icons }
}
