import path from 'node:path'
import { debounce } from 'perfect-debounce'
import type { Nuxt } from '@nuxt/schema'
import type { SpriteCollection } from '../types/types'
import type { CollectionRoot } from '../builders/collection-builder'

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
 * A file belongs to a collection only when it sits DIRECTLY inside one of that
 * collection's own contributing folders (`sources` — a collection merged from an
 * app root and a Nuxt layer root has more than one), not just its
 * highest-priority one. A prefix/startsWith match would wrongly route a file in a
 * brand new, not-yet-known subfolder to its nearest ancestor collection (typically
 * "default", since one of its sources is the tree root) instead of correctly
 * reporting no owner. The one exception is the `default/` merge folder (utils/fs.ts):
 * files placed directly in `<source>/default/` belong to the default collection even
 * though that source's own dir is the tree root, not `<source>/default` — checked for
 * every source of the default collection, not just the highest-priority one.
 */
export function findOwningCollection(
  absPath: string,
  collections: SpriteCollection[],
): SpriteCollection | undefined {
  const dir = path.normalize(path.dirname(absPath))

  const exact = collections.find(c => c.sources.some(s => path.normalize(s.dir) === dir))
  if (exact) return exact

  const defaultCol = collections.find(c => c.segments.length === 0)
  if (defaultCol && defaultCol.sources.some(s => dir === path.normalize(path.join(s.dir, 'default')))) {
    return defaultCol
  }

  return undefined
}

/**
 * Processes a single file-change event for a known collection. Delegates entirely to
 * onCollectionChange (rebuild.ts), which actually unregisters a deleted icon's
 * Use* component itself (via addComponentExports + a filterless updateTemplates())
 * rather than only being able to warn that a restart was needed. Exported for unit
 * testing.
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
 * stale icon list forever (e.g. reporting icons that no longer exist), since only
 * `collectionsRef.current` is updated after a rebuild.
 * The set of collection NAMES is still fixed at setup (a genuinely new collection
 * folder requires a restart, by design — see findOwningCollection).
 */
export function setupWatcher(
  nuxt: Nuxt,
  collectionsRef: { current: SpriteCollection[] },
  roots: CollectionRoot[],
  logger: WatcherLogger,
  onCollectionChange: OnCollectionChange,
): () => void {
  // Normalized once, up front: `roots` (module.ts's resolveLayerInputDirs result) can
  // mix kit-resolved (forward-slash) and node-path-built (native-separator) dirs
  // depending on which branch produced each entry — path.normalize() converts both
  // to the current platform's native separator, matching `absPath` below (itself
  // native via path.resolve), so the prefix comparison can't silently never match on
  // Windows the way a raw string comparison would.
  const normalizedRoots = roots.map(r => ({ ...r, dir: path.normalize(r.dir) }))
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
      // ones inside one of our roots — an unrelated SVG elsewhere in the project (a
      // hero image, a component's own asset) must not trigger this warning. Checked
      // against EVERY known root (the app's own inputDir plus every contributing
      // layer's mirrored icon folder — see resolveLayerInputDirs), not just the
      // app's — a brand-new subfolder under a LAYER's icon folder is exactly as much
      // "needs a restart" as one under the app's own.
      const owningRoot = normalizedRoots.find(r =>
        absPath === r.dir || absPath.startsWith(r.dir + path.sep),
      )
      if (owningRoot) {
        const prefix = owningRoot.label === '(root)' ? '' : `${owningRoot.label}: `
        logger.warn(
          `SVG changed outside known collections (${prefix}"${relativePath}"). Restart the dev server to pick up new collections.`,
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
