import {
  defineNuxtModule,
  useLogger,
  resolvePath,
} from '@nuxt/kit'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { version } from '../package.json'
import { buildAllSprites } from './builders/sprite-builder'
import { buildCollectionsFromDir } from './builders/collection-builder'
import { setupWatcher } from './watcher/watcher'
import { buildIconTypesContent, setupTemplates } from './templates/templates'
import { resolveInjectCollections, setupAutoInject } from './plugins/auto-inject'
import { createRebuildHandler } from './setup/rebuild'
import { setupDevtools } from './devtools/devtools'
import type { IconMeta, ModuleOptions, SpriteCollection } from './types/types'

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
    // svgoConfig deliberately has NO default here. defineNuxtModule's defu-based merge
    // concatenates arrays rather than replacing them, so a default svgoConfig.plugins
    // array would run alongside (not instead of) the user's — silently undoing their
    // overrides. sprite-builder.ts falls back to its own defaultSvgoConfig when the
    // user provides none (see ADR-021 in 07-Decisions.md).
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
      // Still register SvgUse and an (empty) icon-names.d.ts rather than fully
      // bailing — an existing-but-not-yet-populated inputDir is the first thing a
      // fresh install hits, and README/generated-types usage of `SvgUse`/
      // `AllIconName` should not error just because no icons exist yet. The watcher
      // isn't set up here: with zero known collections there's nothing for it to
      // route events to (a brand-new collection folder needs a restart regardless —
      // see watcher.ts), so the extra wiring wouldn't do anything useful yet.
      logger.warn('No SVG icons found in input directory — sprite generation skipped.')
      const handles = setupTemplates([], options, new Map(), () => buildIconTypesContent([]))
      nuxt.hook('prepare:types', ({ references }) => {
        references.push({ path: path.resolve(nuxt.options.buildDir, handles.typeTemplateName) })
      })
      return
    }

    // Track, per collection, which discovered icons actually made it into the sprite
    // — a file can be found during the folder walk but rejected during content
    // processing (unreadable, empty, malformed, non-<svg> root). Generated types and
    // Use* components must be built from THIS set, not the raw walk result, or a
    // rejected icon still gets a type-checking `SvgUse name="broken"` and a
    // `<UseBroken />` component that both compile but render nothing.
    const succeededByCollection = new Map<string, IconMeta[]>()
    const spriteContents = await buildAllSprites(
      collections,
      options.svgoConfig,
      options.optimizeFiles!,
      logger,
      (collectionName, icon, included) => {
        if (!included) return
        const list = succeededByCollection.get(collectionName)
        if (list) list.push(icon)
        else succeededByCollection.set(collectionName, [icon])
      },
    )
    const effectiveCollections: SpriteCollection[] = collections.map(c => ({
      ...c,
      icons: succeededByCollection.get(c.name) ?? [],
    }))

    const collectionsRef = { current: effectiveCollections }
    const iconTypesRef = { current: buildIconTypesContent(effectiveCollections) }

    const handles = setupTemplates(effectiveCollections, options, spriteContents, () => iconTypesRef.current)

    nuxt.hook('prepare:types', ({ references }) => {
      references.push({ path: path.resolve(nuxt.options.buildDir, handles.typeTemplateName) })
    })

    let injectTemplateName: string | undefined
    const injectedCollectionNames = new Set<string>()

    if (!options.autoInjectSprite) {
      if (nuxt.options.dev) {
        const names = effectiveCollections.map(c => `<${c.spriteComponentName} />`).join(', ')
        logger.info(
          `Sprites are not injected automatically. Add ${names} to your app.vue, or set \`autoInjectSprite: true\`.`,
        )
      }
    }
    else {
      if (Array.isArray(options.autoInjectSprite) && options.autoInjectSprite.length === 0) {
        logger.warn(
          'autoInjectSprite: [] injects nothing (same as `false`) — if that\'s intentional, use `autoInjectSprite: false` instead.',
        )
      }
      const injectCols = resolveInjectCollections(options.autoInjectSprite, effectiveCollections, logger)
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
      collectionsRef,
      iconDir,
      logger,
      createRebuildHandler({
        options: {
          componentPrefix: options.componentPrefix!,
          svgoConfig: options.svgoConfig,
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

    const total = effectiveCollections.reduce((n, c) => n + c.icons.length, 0)
    logger.info(
      `Sprite built (${total} icon${total !== 1 ? 's' : ''} across ${effectiveCollections.length} collection${effectiveCollections.length !== 1 ? 's' : ''}).`,
    )
  },
})
