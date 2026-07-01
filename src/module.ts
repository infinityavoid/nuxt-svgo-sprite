import {
  defineNuxtModule,
  updateTemplates,
  useLogger,
  resolvePath,
} from '@nuxt/kit'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Config as SpriteConfig } from 'svg-sprite'
import { version } from '../package.json'
import { defaultSpriteConfig, buildSprite } from './builders/sprite-builder'
import { buildCollectionsFromDir } from './builders/collection-builder'
import { setupWatcher } from './watcher/watcher'
import { buildIconTypesContent, setupTemplates, registerUseComponent } from './templates/templates'

export interface ModuleOptions {
  /**
   * Root directory for SVG files. Collections are discovered automatically from
   * the folder structure. Resolved via `resolvePath`, so `~` aliases work.
   * @default './assets/icons'
   */
  inputDir?: string

  /**
   * Auto-generate a thin wrapper component per icon across all collections.
   * @default false
   */
  createUseComponents?: boolean

  /**
   * Prefix for generated per-icon components.
   * @default 'Use'
   */
  componentPrefix?: string

  /**
   * Run SVGO on every SVG file before adding it to the sprite.
   * @default true
   */
  optimizeFiles?: boolean

  /**
   * Custom svg-sprite configuration, deep-merged over the built-in defaults by Nuxt.
   */
  spriteOptions?: SpriteConfig
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-svgo-sprite',
    configKey: 'svgoSprite',
    version,
    compatibility: { nuxt: '>=3.0.0' },
  },

  defaults: {
    inputDir: './assets/icons',
    createUseComponents: false,
    componentPrefix: 'Use',
    optimizeFiles: true,
    spriteOptions: defaultSpriteConfig,
  },

  async setup(options, nuxt) {
    const logger = useLogger('nuxt-svgo-sprite')

    const iconDir = await resolvePath(options.inputDir!, {
      cwd: nuxt.options.srcDir,
      alias: nuxt.options.alias,
      type: 'dir',
    })

    try {
      await fs.access(iconDir)
    }
    catch {
      // During `nuxt-module-build prepare` the module runs in a synthetic Nuxt context
      // whose srcDir points to the package root (no icons there). This warning is expected
      // in that case and does not affect end users.
      logger.warn(`Input directory "${iconDir}" not found – sprite generation skipped.`)
      return
    }

    let collections = await buildCollectionsFromDir(iconDir, options.componentPrefix!, logger)

    if (collections.length === 0) {
      logger.warn('No SVG icons found in input directory — sprite generation skipped.')
      return
    }

    // ── Build initial sprite content per collection ────────────────────────────
    const spriteContents = new Map<string, string>()
    for (const col of collections) {
      spriteContents.set(
        col.name,
        await buildSprite(col.icons, options.spriteOptions!, options.optimizeFiles!, logger),
      )
    }

    // ── Type content — mutable; updated by the watcher before updateTemplates ──
    let iconTypesContent = buildIconTypesContent(collections)

    // ── Register all templates and components ─────────────────────────────────
    const handles = setupTemplates(collections, options, spriteContents, () => iconTypesContent)

    // ── Register type file in consumer tsconfig ───────────────────────────────
    nuxt.hook('prepare:types', ({ references }) => {
      references.push({
        path: path.resolve(nuxt.options.buildDir, handles.typeTemplateName),
      })
    })

    // ── Per-collection debounced watcher ──────────────────────────────────────
    setupWatcher(nuxt, collections, logger, async (collection, event, absPath) => {
      logger.info(`${event}: "${absPath}" – rebuilding collection "${collection.name}"…`)

      const updated = await buildCollectionsFromDir(iconDir, options.componentPrefix!, logger)
      collections = updated

      const updatedCol = updated.find(c => c.name === collection.name)
      spriteContents.set(
        collection.name,
        await buildSprite(
          updatedCol?.icons ?? [],
          options.spriteOptions!,
          options.optimizeFiles!,
          logger,
        ),
      )
      iconTypesContent = buildIconTypesContent(updated)

      const spriteTplName = handles.spriteTemplateNames.get(collection.name)
      await updateTemplates({
        filter: t => t.filename === spriteTplName || t.filename === handles.typeTemplateName,
      })

      if (event === 'add' && options.createUseComponents && updatedCol) {
        const newIcon = updatedCol.icons.find(i => i.absolutePath === absPath)
        if (newIcon) {
          registerUseComponent(newIcon)
          logger.info(`Registered new component <${newIcon.componentName} />.`)
        }
      }
    })

    const totalIcons = collections.reduce((n, c) => n + c.icons.length, 0)
    logger.info(
      `Sprite built (${totalIcons} icon${totalIcons !== 1 ? 's' : ''} across ${collections.length} collection${collections.length !== 1 ? 's' : ''}).`,
    )
  },
})
