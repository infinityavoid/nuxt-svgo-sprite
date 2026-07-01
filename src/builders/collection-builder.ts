import path from 'node:path'
import { walkInputDir } from '../utils/fs'
import {
  buildIconMeta,
  deriveCollectionName,
  deriveTypeName,
  deriveSpriteComponentName,
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
  const entries = await walkInputDir(resolvedInputDir)
  const collections: SpriteCollection[] = []

  for (const entry of entries) {
    const { segments, files } = entry
    const name = deriveCollectionName(segments)

    const seenIds = new Set<string>()
    const icons: IconMeta[] = []

    for (const filePath of files) {
      const filename = path.basename(filePath)
      const meta = buildIconMeta(filename, segments, filePath, componentPrefix)

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
    // Named collections → inputDir is the specific subfolder.
    const collectionDir = segments.length === 0
      ? resolvedInputDir
      : path.join(resolvedInputDir, ...segments)

    collections.push({
      name,
      segments: segments.slice(),
      inputDir: collectionDir,
      spriteComponentName: deriveSpriteComponentName(name),
      typeName: deriveTypeName(name),
      icons,
    })
  }

  return collections
}
