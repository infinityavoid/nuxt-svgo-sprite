import { updateTemplates } from '@nuxt/kit'
import type { Config as SpriteConfig } from 'svg-sprite'
import { rebuildSingleCollection } from '../builders/collection-builder'
import { buildSprite } from '../builders/sprite-builder'
import { buildIconTypesContent, registerUseComponent } from '../templates/templates'
import type { SpriteCollection } from '../types/types'
import type { TemplateHandles } from '../templates/templates'

interface RebuildOptions {
  componentPrefix: string
  spriteOptions: SpriteConfig
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
}

export function createRebuildHandler(ctx: RebuildContext) {
  return async (collection: SpriteCollection, event: string, absPath: string): Promise<void> => {
    ctx.logger.info(`${event}: "${absPath}" – rebuilding collection "${collection.name}"…`)

    const updatedCol = await rebuildSingleCollection(
      collection,
      ctx.options.componentPrefix,
      ctx.logger,
    )
    ctx.collectionsRef.current = ctx.collectionsRef.current.map(c =>
      c.name === collection.name ? updatedCol : c,
    )
    ctx.spriteContents.set(
      collection.name,
      await buildSprite(
        updatedCol.icons,
        ctx.options.spriteOptions,
        ctx.options.optimizeFiles,
        ctx.logger,
      ),
    )
    ctx.iconTypesRef.current = buildIconTypesContent(ctx.collectionsRef.current)

    const spriteTplName = ctx.handles.spriteTemplateNames.get(collection.name)
    const updateInject = ctx.injectTemplateName && ctx.injectedCollectionNames.has(collection.name)

    await updateTemplates({
      filter: t =>
        t.filename === spriteTplName
        || t.filename === ctx.handles.typeTemplateName
        || (updateInject === true && t.filename === ctx.injectTemplateName),
    })

    if (event === 'add' && ctx.options.createUseComponents && updatedCol) {
      const newIcon = updatedCol.icons.find(i => i.absolutePath === absPath)
      if (newIcon) {
        registerUseComponent(newIcon)
        ctx.logger.info(`Registered new component <${newIcon.componentName} />.`)
      }
    }
  }
}
