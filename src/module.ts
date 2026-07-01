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
import { setupAutoInject } from './plugins/auto-inject'
import type { SpriteCollection } from './types/types'

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

  /**
   * Inject sprite components automatically:
   *   false      — user places sprite components manually (default)
   *   true       — all collection sprites injected into every page
   *   string[]   — only the listed collection names are injected
   * @default false
   */
  autoInjectSprite?: boolean | string[]
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
    autoInjectSprite: false,
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

    // ── autoInjectSprite ──────────────────────────────────────────────────────
    let injectTemplateName: string | undefined
    const injectedCollectionNames = new Set<string>()

    if (!options.autoInjectSprite) {
      if (nuxt.options.dev) {
        const names = collections.map(c => `<${c.spriteComponentName} />`).join(', ')
        logger.info(
          `Sprites are not injected automatically. Add ${names} to your app.vue, or set \`autoInjectSprite: true\`.`,
        )
      }
    }
    else {
      const injectCols = resolveInjectCollections(options.autoInjectSprite, collections, logger)
      if (injectCols.length > 0) {
        injectTemplateName = setupAutoInject(injectCols, spriteContents)
        for (const c of injectCols) injectedCollectionNames.add(c.name)
      }
    }

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
      const updateInject = injectTemplateName && injectedCollectionNames.has(collection.name)

      await updateTemplates({
        filter: t =>
          t.filename === spriteTplName
          || t.filename === handles.typeTemplateName
          || (updateInject === true && t.filename === injectTemplateName),
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

function resolveInjectCollections(
  opt: true | string[],
  collections: SpriteCollection[],
  logger: ReturnType<typeof useLogger>,
): SpriteCollection[] {
  if (opt === true) return collections

  const known = new Set(collections.map(c => c.name))
  for (const name of opt) {
    if (!known.has(name)) {
      logger.warn(
        `autoInjectSprite: unknown collection "${name}". Known collections: ${[...known].join(', ')}.`,
      )
    }
  }
  return collections.filter(c => opt.includes(c.name))
}
