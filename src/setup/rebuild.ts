import { updateTemplates } from '@nuxt/kit'
import type { Config as SvgoConfig } from 'svgo'
import { rebuildSingleCollection } from '../builders/collection-builder'
import { buildSprite, type SymbolCache, type ColorNormalizationOptions } from '../builders/sprite-builder'
import { buildIconTypesContent, writeUseComponentsFileSync } from '../templates/templates'
import type { IconMeta, SpriteCollection } from '../types/types'
import type { TemplateHandles } from '../templates/templates'
import type { IsIgnored } from '../utils/fs'

interface RebuildOptions {
  componentPrefix: string
  svgoConfig: SvgoConfig | undefined
  optimizeFiles: boolean
  createUseComponents: boolean
  colorOptions?: ColorNormalizationOptions
}

interface RebuildLogger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export interface RebuildContext {
  options: RebuildOptions
  collectionsRef: { current: SpriteCollection[] }
  spriteContents: Map<string, string>
  iconTypesRef: { current: string }
  handles: TemplateHandles
  injectTemplateName: string | undefined
  injectedCollectionNames: Set<string>
  logger: RebuildLogger
  broadcastRefresh?: () => Promise<void>
  /** Same instance the cold build populated — lets an unchanged icon in the rescanned
   * collection skip re-reading/re-optimizing. Optional for callers that don't need it
   * (e.g. tests). */
  symbolCache?: SymbolCache
  /**
   * Same filter the cold build applied — keeps a rebuild consistent with it (an
   * ignored file must not reappear on rescan just because it changed).
   */
  isIgnored?: IsIgnored
}

export function createRebuildHandler(ctx: RebuildContext) {
  return async (collection: SpriteCollection, event: string, absPath: string): Promise<void> => {
    ctx.logger.info(`${event}: "${absPath}" – rebuilding collection "${collection.name}"…`)

    try {
      const rescanned = await rebuildSingleCollection(
        collection,
        ctx.options.componentPrefix,
        ctx.logger,
        ctx.isIgnored,
      )

      // Re-check symbol-id uniqueness against the OTHER live collections — a single-
      // collection rescan can't see this on its own, but a rename that collides with
      // an icon in another collection is exactly as unsafe here as at cold build
      // (see buildCollectionsFromDir's global pass 2).
      const otherIds = new Set(
        ctx.collectionsRef.current
          .filter(c => c.name !== collection.name)
          .flatMap(c => c.icons.map(i => i.id)),
      )
      const idCollisionFiltered = rescanned.icons.filter((icon) => {
        if (otherIds.has(icon.id)) {
          ctx.logger.warn(
            `Symbol id collision: "${icon.id}" in collection "${rescanned.name}" is already used by `
            + `another collection — skipping "${icon.absolutePath}".`,
          )
          return false
        }
        return true
      })

      // As at cold build (module.ts): buildSprite can reject an individual icon
      // during content processing (unreadable, empty, malformed, non-<svg> root)
      // even though it survived folder discovery. Generated types/components must
      // reflect only what actually made it into the sprite, or a rejected icon still
      // typechecks and renders a dead reference.
      const succeeded: IconMeta[] = []
      const sprite = await buildSprite(
        idCollisionFiltered,
        ctx.options.svgoConfig,
        ctx.options.optimizeFiles,
        ctx.logger,
        rescanned.name,
        (icon, included) => { if (included) succeeded.push(icon) },
        ctx.symbolCache,
        ctx.options.colorOptions,
      )
      const updatedCol = { ...rescanned, icons: succeeded }

      ctx.collectionsRef.current = ctx.collectionsRef.current.map(c =>
        c.name === collection.name ? updatedCol : c,
      )
      ctx.spriteContents.set(collection.name, sprite)
      ctx.iconTypesRef.current = buildIconTypesContent(ctx.collectionsRef.current)

      const spriteTplName = ctx.handles.spriteTemplateNames.get(collection.name)
      const updateInject = ctx.injectTemplateName && ctx.injectedCollectionNames.has(collection.name)

      await updateTemplates({
        filter: t =>
          t.filename === spriteTplName
          || t.filename === ctx.handles.typeTemplateName
          || (updateInject === true && t.filename === ctx.injectTemplateName),
      })

      if (ctx.options.createUseComponents && ctx.handles.useComponentsFilePath) {
        // Diff against the collection's icon list from BEFORE this rebuild, rather
        // than trusting `event`/`absPath` alone — the debounced handler only ever
        // fires with the LAST raw fs event's arguments, so dropping several changes
        // into a folder at once (or an 'add' immediately followed by an 'unlink')
        // can coalesce into one firing whose event/absPath describe only one of the
        // changes. Comparing the full before/after icon sets catches all of them
        // regardless of what triggered this particular rebuild.
        const previousPaths = new Set(collection.icons.map(i => i.absolutePath))
        const currentPaths = new Set(updatedCol.icons.map(i => i.absolutePath))
        const added = updatedCol.icons.filter(i => !previousPaths.has(i.absolutePath))
        const removed = collection.icons.filter(i => !currentPaths.has(i.absolutePath))

        if (added.length > 0 || removed.length > 0) {
          // Rewrite the WHOLE shared Use* components file from the current,
          // authoritative icon set (ctx.collectionsRef.current already reflects
          // updatedCol, updated above) — addComponentExports re-reads this file's
          // export names fresh on every components:dirs firing, so a dropped export
          // here genuinely unregisters that icon's component (ADR-025/ADR-011),
          // not just a warning telling the user to restart.
          writeUseComponentsFileSync(ctx.handles.useComponentsFilePath, ctx.collectionsRef.current)
          for (const icon of added) ctx.logger.info(`Registered new component <${icon.componentName} />.`)
          for (const icon of removed) ctx.logger.info(`Unregistered component <${icon.componentName} />.`)

          // addComponentExports' re-resolution only takes effect the next time
          // Nuxt's own components module re-scans (components:extend), which is
          // gated behind Nuxt's internal "app structure version" cache — the
          // FILTERED updateTemplates() call above does NOT invalidate that cache
          // (only a call with no filter does), so on its own it would leave the
          // rewritten file unregistered until some unrelated file event happened to
          // trigger a full regen. A no-filter call forces that re-resolution
          // ourselves, right here, rather than depending on Nuxt's own builder:watch
          // handler happening to run after ours (see watcher.ts for why that can no
          // longer be assumed).
          await updateTemplates()
        }
      }

      await ctx.broadcastRefresh?.()
    }
    catch (err) {
      // A transient FS error (e.g. EBUSY/EPERM while an editor rewrites a file) must
      // not crash the watcher — log and leave the previous sprite/collection state in
      // place; the next file-change event gets another chance.
      ctx.logger.error(`Failed to rebuild collection "${collection.name}" after ${event} "${absPath}": ${String(err)}`)
    }
  }
}
