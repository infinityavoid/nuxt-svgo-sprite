import path from 'node:path'
import { debounce } from 'perfect-debounce'
import type { Nuxt } from '@nuxt/schema'
import type { SpriteCollection } from '../types/types'

export interface WatcherLogger {
  info(msg: string): void
  warn(msg: string): void
}

export type OnCollectionChange = (
  collection: SpriteCollection,
  event: string,
  absPath: string,
) => Promise<void>

/**
 * Returns the collection that owns the given absolute path.
 * When multiple collections match (e.g. default and a named sub-collection),
 * the most specific (deepest inputDir) one wins.
 */
export function findOwningCollection(
  absPath: string,
  collections: SpriteCollection[],
): SpriteCollection | undefined {
  const candidates = collections.filter((c) => {
    // Append sep to avoid matching /icons-extra when inputDir is /icons
    const prefix = c.inputDir.endsWith(path.sep) ? c.inputDir : c.inputDir + path.sep
    return absPath.startsWith(prefix) || absPath === c.inputDir
  })
  return candidates.sort((a, b) => b.inputDir.length - a.inputDir.length)[0]
}

/**
 * Processes a single file-change event for a known collection.
 * Logs the ADR-011 unlink warning; always calls onCollectionChange.
 * Exported for unit testing.
 */
export async function handleWatchEvent(
  event: string,
  absPath: string,
  collection: SpriteCollection,
  logger: WatcherLogger,
  onCollectionChange: OnCollectionChange,
): Promise<void> {
  if (event === 'unlink') {
    const removedIcon = collection.icons.find(i => i.absolutePath === absPath)
    if (removedIcon) {
      logger.warn(
        `Icon "${removedIcon.id}" removed from sprite. Restart dev server to unregister component ${removedIcon.componentName}.`,
      )
    }
  }
  await onCollectionChange(collection, event, absPath)
}

/**
 * Registers one debounced builder:watch handler per collection on the Nuxt instance.
 * Rapid changes within one collection are coalesced; changes in different collections
 * fire independently via their own debounced handler.
 */
export function setupWatcher(
  nuxt: Nuxt,
  collections: SpriteCollection[],
  logger: WatcherLogger,
  onCollectionChange: OnCollectionChange,
): () => void {
  const handlers = new Map(
    collections.map(collection => [
      collection.name,
      debounce(
        (event: string, absPath: string) =>
          handleWatchEvent(event, absPath, collection, logger, onCollectionChange),
        100,
      ),
    ]),
  )

  nuxt.hook('builder:watch', async (event, relativePath) => {
    if (!relativePath.endsWith('.svg')) return

    const absPath = path.resolve(nuxt.options.rootDir, relativePath)
    const collection = findOwningCollection(absPath, collections)
    if (!collection) {
      logger.warn(
        `SVG changed outside known collections ("${relativePath}"). Restart the dev server to pick up new collections.`,
      )
      return
    }

    const handler = handlers.get(collection.name)
    if (handler) await handler(event, absPath)
  })

  return () => {
    for (const handler of handlers.values()) {
      handler.cancel()
    }
  }
}
