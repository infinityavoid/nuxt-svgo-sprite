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
 * "default", since its inputDir is the tree root) instead of correctly reporting no
 * owner. The one exception is the `default/` merge folder (utils/fs.ts): files placed
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
 * Processes a single file-change event for a known collection. Delegates entirely to
 * onCollectionChange (rebuild.ts), which — since ADR-025 closed ADR-011 — now
 * actually unregisters a deleted icon's Use* component itself (via
 * addComponentExports + a filterless updateTemplates()) instead of only being able to
 * warn that a restart was needed. Exported for unit testing.
 */
export async function handleWatchEvent(
  event: string,
  absPath: string,
  collection: SpriteCollection,
  logger: WatcherLogger,
  onCollectionChange: OnCollectionChange,
): Promise<void> {
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
  resolvedInputDir: string,
  logger: WatcherLogger,
  onCollectionChange: OnCollectionChange,
): () => void {
  const inputDirPrefix = resolvedInputDir.endsWith(path.sep) ? resolvedInputDir : resolvedInputDir + path.sep
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

    // Nuxt itself always resolves builder:watch's relativePath against srcDir, not
    // rootDir — confirmed against multiple first-party call sites (the core
    // components and imports modules). They differ whenever the user configures a
    // custom srcDir (e.g. `srcDir: 'app'`), which is a supported, documented Nuxt
    // config — resolving against the wrong base there would silently never match any
    // real collection. resolve() is safe either way when relativePath happens to
    // already be absolute (chokidar can emit either form).
    const absPath = path.resolve(nuxt.options.srcDir, relativePath)
    const collection = findOwningCollection(absPath, collectionsRef.current)
    if (!collection) {
      // Nuxt's builder:watch fires for every changed file under srcDir, not just
      // ones inside our inputDir — an unrelated SVG elsewhere in the project (a
      // hero image, a component's own asset) must not trigger this warning.
      if (absPath === resolvedInputDir || absPath.startsWith(inputDirPrefix)) {
        logger.warn(
          `SVG changed outside known collections ("${relativePath}"). Restart the dev server to pick up new collections.`,
        )
      }
      return
    }

    const handler = handlers.get(collection.name)
    // Deliberately NOT awaited: hookable calls every builder:watch handler in
    // sequence, awaiting each before calling the next — awaiting the debounced
    // handler here (perfect-debounce resolves EVERY call only once the eventual
    // trailing invocation settles, not just the last one in a burst) blocked Nuxt's
    // entire builder:watch chain — its own internal handler, every other module's —
    // for the full debounce delay plus a complete collection rebuild, on every
    // single .svg save. Safe now that createRebuildHandler does its own filterless
    // updateTemplates() when a new component needs registering (rebuild.ts) —
    // correctness no longer depends on Nuxt's own builder:watch handler happening to
    // run afterward, which is what made the previous awaited version work at all.
    // Errors are handled inside createRebuildHandler's own try/catch and never
    // reach here; .catch is defensive against an unexpected rejection reaching this
    // point unhandled.
    if (handler) {
      handler(event, absPath, collection).catch((err: unknown) => {
        logger.warn(`Unexpected error while rebuilding collection "${collection.name}": ${String(err)}`)
      })
    }
  })

  return () => {
    for (const handler of handlers.values()) {
      handler.cancel()
    }
  }
}
