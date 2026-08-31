import {
  defineNuxtModule,
  useLogger,
  resolvePath,
  createIsIgnored,
} from '@nuxt/kit'
import { promises as fs } from 'node:fs'
import { version } from '../package.json'
import { buildAllSprites, totalSpriteBytes, type SymbolCache } from './builders/sprite-builder'
import { buildCollectionsFromDir } from './builders/collection-builder'
import { scanUsedIconIds } from './builders/usage-scanner'
import { resolveLayerInputDirs, isOutsideSrcDir } from './utils/layers'
import { setupWatcher } from './watcher/watcher'
import { buildIconTypesContent, setupTemplates } from './templates/templates'
import { resolveInjectCollections, setupAutoInject } from './plugins/auto-inject'
import { createRebuildHandler } from './setup/rebuild'
import { setupDevtools } from './devtools/devtools'
import type { IconMeta, ModuleOptions, SpriteCollection } from './types/types'

export type { ModuleOptions } from './types/types'

export default defineNuxtModule<ModuleOptions>().with({
  meta: {
    name: 'nuxt-svgo-sprite',
    configKey: 'svgoSprite',
    version,
    // Matches (not "at least") the @nuxt/kit dependency's own floor below —
    // see ADR-023. A lower floor here would be an untestable promise: on a host
    // Nuxt below the version its own @nuxt/kit satisfies our ^ dependency range,
    // npm/pnpm can't dedupe @nuxt/kit against the host's copy, forcing a second,
    // separate @nuxt/kit install whose module-level state (e.g. useNuxt()'s
    // context) isn't shared with the host's own kit-based modules.
    compatibility: { nuxt: '>=4.4.8' },
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
    // user provides none.
    autoInjectSprite: false,
    normalizeColors: false,
    treeShaking: false,
  },

  async setup(options, nuxt) {
    const logger = useLogger('nuxt-svgo-sprite')

    const iconDir = await resolvePath(options.inputDir, {
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

    // Cold build previously had no notion of nuxt.options.ignore/.nuxtignore at all —
    // only the dev watcher (via chokidar's own ignore list) honored it. An ignored
    // icon folder used to build fine once, then never hot-reload again with zero
    // warning: the watcher silently never fired for it, but the cold-built sprite
    // still had its icons. Applying the same filter here means an ignored folder's
    // icons consistently never appear at all, matching the watcher.
    const isIgnored = createIsIgnored(nuxt)

    // inputDir resolving outside srcDir (e.g. `inputDir: '~~/icons'`) is a supported,
    // valid config — but Nuxt's default dev watcher only covers each layer's own
    // srcDir tree, so a folder outside it built fine once and then silently never
    // hot-reloaded, forever. Matches Nuxt's own components module precedent (same
    // check, same fix: push onto nuxt.options.watch when not already covered). Safe:
    // Nuxt's restart-on-add/unlinkDir check requires exact path equality against a
    // watched dir, not a prefix match, so this can't cause restart storms.
    if (nuxt.options.dev && isOutsideSrcDir(nuxt, iconDir) && !nuxt.options.watch.includes(iconDir)) {
      nuxt.options.watch.push(iconDir)
    }

    const layerRoots = await resolveLayerInputDirs(nuxt, iconDir)
    const collections = await buildCollectionsFromDir(
      layerRoots.length > 1 ? layerRoots : iconDir,
      options.componentPrefix,
      logger,
      isIgnored,
    )
    if (collections.length === 0) {
      // Still register SvgUse and an (empty) icon-names.d.ts rather than fully
      // bailing — an existing-but-not-yet-populated inputDir is the first thing a
      // fresh install hits, and README/generated-types usage of `SvgUse`/
      // `AllIconName` should not error just because no icons exist yet. The watcher
      // isn't set up here: with zero known collections there's nothing for it to
      // route events to (a brand-new collection folder needs a restart regardless —
      // see watcher.ts), so the extra wiring wouldn't do anything useful yet.
      logger.warn('No SVG icons found in input directory — sprite generation skipped.')
      // setupTemplates uses addTypeTemplate for the .d.ts, which registers the
      // prepare:types push itself — no manual nuxt.hook('prepare:types', ...) needed.
      setupTemplates([], options, new Map(), () => buildIconTypesContent([]))
      return
    }

    // Track, per collection, which discovered icons actually made it into the sprite
    // — a file can be found during the folder walk but rejected during content
    // processing (unreadable, empty, malformed, non-<svg> root). Generated types and
    // Use* components must be built from THIS set, not the raw walk result, or a
    // rejected icon still gets a type-checking `SvgUse name="broken"` and a
    // `<UseBroken />` component that both compile but render nothing.
    const succeededByCollection = new Map<string, IconMeta[]>()
    // Shared for the module's lifetime: the cold build below populates it, and every
    // HMR rebuild (rebuild.ts) reuses the SAME instance so an unchanged icon skips
    // re-reading and re-optimizing on every keystroke-triggered rebuild of the rest
    // of its collection. No effect on a one-shot production build.
    const symbolCache: SymbolCache = new Map()

    // Item #6: opt-in, production-build-only (nuxt dev never shakes — an icon
    // "disappearing" mid-development because the scanner missed a usage is far
    // harder to notice/debug than the same thing happening in a build you're about
    // to deploy). Narrows only the SPRITE payload this call returns — collections,
    // generated types, DevTools, and Use* components below all still see the FULL
    // icon set regardless, so autocomplete/type-checking/DevTools stay identical to
    // a non-tree-shaken build; only what actually ships in the inlined <symbol>
    // markup shrinks. Vite's own dead-code elimination already drops an unused
    // Use* component export from the CLIENT bundle for free — this specifically
    // targets the inline SSR sprite string, which no bundler can tree-shake since
    // it's not a set of discrete importable modules.
    let isIconUsed: ((icon: IconMeta) => boolean) | undefined
    if (options.treeShaking && !nuxt.options.dev) {
      const usedIds = await scanUsedIconIds(
        nuxt.options.srcDir,
        collections,
        nuxt.options.extensions,
        [nuxt.options.buildDir],
        logger,
      )
      const alwaysInclude = new Set(options.treeShakingInclude ?? [])
      isIconUsed = icon => usedIds.has(icon.id) || alwaysInclude.has(icon.id)
    }

    const spriteContents = await buildAllSprites(
      collections,
      options.svgoConfig,
      options.optimizeFiles,
      logger,
      (collectionName, icon, included) => {
        if (!included) return
        const list = succeededByCollection.get(collectionName)
        if (list) list.push(icon)
        else succeededByCollection.set(collectionName, [icon])
      },
      symbolCache,
      { normalize: options.normalizeColors, exclude: options.normalizeColorsExclude },
      isIconUsed,
    )
    const effectiveCollections: SpriteCollection[] = collections.map(c => ({
      ...c,
      icons: succeededByCollection.get(c.name) ?? [],
    }))

    const collectionsRef = { current: effectiveCollections }
    const iconTypesRef = { current: buildIconTypesContent(effectiveCollections) }

    // setupTemplates uses addTypeTemplate for the .d.ts, which registers the
    // prepare:types push itself — no manual nuxt.hook('prepare:types', ...) needed.
    const handles = setupTemplates(
      effectiveCollections,
      options,
      spriteContents,
      () => iconTypesRef.current,
      () => collectionsRef.current,
    )

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
      broadcastRefresh = setupDevtools(nuxt, collectionsRef, injectedCollectionNames, options.createUseComponents)
    }

    const cleanup = setupWatcher(
      nuxt,
      collectionsRef,
      iconDir,
      logger,
      createRebuildHandler({
        options: {
          componentPrefix: options.componentPrefix,
          svgoConfig: options.svgoConfig,
          optimizeFiles: options.optimizeFiles,
          createUseComponents: options.createUseComponents,
          colorOptions: { normalize: options.normalizeColors, exclude: options.normalizeColorsExclude },
        },
        collectionsRef,
        spriteContents,
        iconTypesRef,
        handles,
        injectTemplateName,
        injectedCollectionNames,
        logger,
        broadcastRefresh,
        symbolCache,
        isIgnored,
      }),
    )

    nuxt.hook('close', cleanup)

    const total = effectiveCollections.reduce((n, c) => n + c.icons.length, 0)
    const totalKb = totalSpriteBytes(spriteContents) / 1024
    logger.info(
      `Sprite built (${total} icon${total !== 1 ? 's' : ''} across ${effectiveCollections.length} `
      + `collection${effectiveCollections.length !== 1 ? 's' : ''}, ${totalKb.toFixed(1)} kB).`,
    )
    if (options.sizeLimitKb !== undefined && totalKb > options.sizeLimitKb) {
      logger.warn(
        `Total inlined sprite payload (${totalKb.toFixed(1)} kB) exceeds sizeLimitKb `
        + `(${options.sizeLimitKb} kB) — every inlined sprite ships on every page. `
        + `Consider optimizing your icons or splitting rarely-used collections.`,
      )
    }
  },
})
