import {
  defineNuxtModule,
  useLogger,
  resolvePath,
} from '@nuxt/kit'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { version } from '../package.json'
import { defaultSvgoConfig, buildAllSprites } from './builders/sprite-builder'
import { buildCollectionsFromDir } from './builders/collection-builder'
import { setupWatcher } from './watcher/watcher'
import { buildIconTypesContent, setupTemplates } from './templates/templates'
import { resolveInjectCollections, setupAutoInject } from './plugins/auto-inject'
import { createRebuildHandler } from './setup/rebuild'
import { setupDevtools } from './devtools/devtools'
import type { ModuleOptions } from './types/types'

export type { ModuleOptions } from './types/types'

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-svgo-sprite',
    configKey: 'svgoSprite',
    version,
    compatibility: { nuxt: '>=3.0.0' },
  },

  defaults: {
    inputDir: '~/assets/icons',
    createUseComponents: false,
    componentPrefix: 'Use',
    optimizeFiles: true,
    svgoConfig: defaultSvgoConfig,
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
      options.svgoConfig!,
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

    let broadcastRefresh: (() => Promise<void>) | undefined
    if (nuxt.options.dev) {
      broadcastRefresh = setupDevtools(nuxt, collectionsRef, injectedCollectionNames)
    }

    const cleanup = setupWatcher(
      nuxt,
      collections,
      logger,
      createRebuildHandler({
        options: {
          componentPrefix: options.componentPrefix!,
          svgoConfig: options.svgoConfig!,
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
        broadcastRefresh,
      }),
    )

    nuxt.hook('close', cleanup)

    const total = collections.reduce((n, c) => n + c.icons.length, 0)
    logger.info(
      `Sprite built (${total} icon${total !== 1 ? 's' : ''} across ${collections.length} collection${collections.length !== 1 ? 's' : ''}).`,
    )
  },
})
