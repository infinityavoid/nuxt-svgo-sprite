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
 * A file belongs to a collection only when it sits DIRECTLY inside that collection's
 * own folder (segments are collection boundaries — ADR-002, no namespacing within
 * one collection). A prefix/startsWith match would wrongly route a file in a brand
 * new, not-yet-known subfolder to its nearest ancestor collection (typically
 * "default", since its inputDir is the tree root) instead of surfacing the
 * "restart the dev server" warning — see the Phase 14 audit.
 * The one exception is the `default/` merge folder (utils/fs.ts): files placed
 * directly in `<inputDir>/default/` belong to the default collection even though its
 * own `inputDir` is the tree root, not `<inputDir>/default`.
 */
export function findOwningCollection(
  absPath: string,
  collections: SpriteCollection[],
): SpriteCollection | undefined {
  const dir = path.normalize(path.dirname(absPath))

  const exact = collections.find(c => path.normalize(c.inputDir) === dir)
  if (exact) return exact

  const defaultCol = collections.find(c => c.segments.length === 0)
  if (defaultCol && dir === path.normalize(path.join(defaultCol.inputDir, 'default'))) {
    return defaultCol
  }

  return undefined
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
 *
 * `collectionsRef` is read live at event time (not just at setup) — a debounced
 * handler that closed over its collection at setup time would keep acting on a
 * stale icon list forever (e.g. ADR-011's delete warning firing from icons that no
 * longer exist), since only `collectionsRef.current` is updated after a rebuild.
 * The set of collection NAMES is still fixed at setup (a genuinely new collection
 * folder requires a restart, by design — see findOwningCollection).
 */
export function setupWatcher(
  nuxt: Nuxt,
  collectionsRef: { current: SpriteCollection[] },
  logger: WatcherLogger,
  onCollectionChange: OnCollectionChange,
): () => void {
  const handlers = new Map(
    collectionsRef.current.map(collection => [
      collection.name,
      debounce(
        (event: string, absPath: string, currentCollection: SpriteCollection) =>
          handleWatchEvent(event, absPath, currentCollection, logger, onCollectionChange),
        100,
      ),
    ]),
  )

  nuxt.hook('builder:watch', async (event, relativePath) => {
    if (!/\.svg$/i.test(relativePath)) return

    // `relativePath` is already absolute on recent Nuxt (path.resolve is then a
    // no-op), but on Nuxt versions where builder:watch reports a path relative to
    // srcDir rather than rootDir, resolving against rootDir alone silently finds no
    // owning collection whenever srcDir !== rootDir. Try both before giving up.
    const fromRoot = path.resolve(nuxt.options.rootDir, relativePath)
    const absPath = findOwningCollection(fromRoot, collectionsRef.current)
      ? fromRoot
      : path.resolve(nuxt.options.srcDir, relativePath)
    const collection = findOwningCollection(absPath, collectionsRef.current)
    if (!collection) {
      logger.warn(
        `SVG changed outside known collections ("${relativePath}"). Restart the dev server to pick up new collections.`,
      )
      return
    }

    const handler = handlers.get(collection.name)
    if (handler) await handler(event, absPath, collection)
  })

  return () => {
    for (const handler of handlers.values()) {
      handler.cancel()
    }
  }
}
