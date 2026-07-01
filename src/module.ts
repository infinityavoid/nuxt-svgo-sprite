import {
  defineNuxtModule,
  useLogger,
  resolvePath,
} from '@nuxt/kit'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Config as SpriteConfig } from 'svg-sprite'
import { version } from '../package.json'
import { defaultSpriteConfig, buildAllSprites } from './builders/sprite-builder'
import { buildCollectionsFromDir } from './builders/collection-builder'
import { setupWatcher } from './watcher/watcher'
import { buildIconTypesContent, setupTemplates } from './templates/templates'
import { resolveInjectCollections, setupAutoInject } from './plugins/auto-inject'
import { createRebuildHandler } from './setup/rebuild'

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

    const collections = await buildCollectionsFromDir(iconDir, options.componentPrefix!, logger)
    if (collections.length === 0) {
      logger.warn('No SVG icons found in input directory — sprite generation skipped.')
      return
    }

    const spriteContents = await buildAllSprites(
      collections,
      options.spriteOptions!,
      options.optimizeFiles!,
      logger,
    )
    const collectionsRef = { current: collections }
    const iconTypesRef = { current: buildIconTypesContent(collections) }

    const handles = setupTemplates(collections, options, spriteContents, () => iconTypesRef.current)

    nuxt.hook('prepare:types', ({ references }) => {
      references.push({ path: path.resolve(nuxt.options.buildDir, handles.typeTemplateName) })
    })

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

    const cleanup = setupWatcher(
      nuxt,
      collections,
      logger,
      createRebuildHandler({
        iconDir,
        options: {
          componentPrefix: options.componentPrefix!,
          spriteOptions: options.spriteOptions!,
          optimizeFiles: options.optimizeFiles!,
          createUseComponents: options.createUseComponents!,
        },
        collectionsRef,
        spriteContents,
        iconTypesRef,
        handles,
        injectTemplateName,
        injectedCollectionNames,
        logger,
      }),
    )

    nuxt.hook('close', cleanup)

    const total = collections.reduce((n, c) => n + c.icons.length, 0)
    logger.info(
      `Sprite built (${total} icon${total !== 1 ? 's' : ''} across ${collections.length} collection${collections.length !== 1 ? 's' : ''}).`,
    )
  },
})
