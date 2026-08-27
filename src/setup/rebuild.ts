import { updateTemplates } from '@nuxt/kit'
import type { Config as SvgoConfig } from 'svgo'
import { rebuildSingleCollection } from '../builders/collection-builder'
import { buildSprite, type SymbolCache } from '../builders/sprite-builder'
import { buildIconTypesContent, registerUseComponent } from '../templates/templates'
import type { IconMeta, SpriteCollection } from '../types/types'
import type { TemplateHandles } from '../templates/templates'

interface RebuildOptions {
  componentPrefix: string
  svgoConfig: SvgoConfig | undefined
  optimizeFiles: boolean
  createUseComponents: boolean
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
}

export function createRebuildHandler(ctx: RebuildContext) {
  return async (collection: SpriteCollection, event: string, absPath: string): Promise<void> => {
    ctx.logger.info(`${event}: "${absPath}" – rebuilding collection "${collection.name}"…`)

    try {
      const rescanned = await rebuildSingleCollection(
        collection,
        ctx.options.componentPrefix,
        ctx.logger,
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

      if (ctx.options.createUseComponents) {
        // Diff against the collection's icon list from BEFORE this rebuild, rather
        // than trusting `event`/`absPath` alone — the debounced handler only ever
        // fires with the LAST raw fs event's arguments, so dropping several new
        // files into a folder at once (or an 'add' immediately followed by a
        // 'change') can coalesce into one firing whose event/absPath describe only
        // one of the changes. Registering every icon that's newly present catches
        // all of them regardless of what triggered this particular rebuild.
        const previousPaths = new Set(collection.icons.map(i => i.absolutePath))
        for (const newIcon of updatedCol.icons) {
          if (previousPaths.has(newIcon.absolutePath)) continue
          registerUseComponent(newIcon)
          ctx.logger.info(`Registered new component <${newIcon.componentName} />.`)
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
