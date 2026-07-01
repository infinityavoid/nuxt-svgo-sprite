import {
  defineNuxtModule,
  addComponent,
  addTemplate,
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
import type { SpriteCollection, IconMeta } from './types/types'

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
   * @default 'use'
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
    componentPrefix: 'use',
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

    // ── Sprite content per collection ──────────────────────────────────────────
    const spriteContents = new Map<string, string>()
    for (const col of collections) {
      spriteContents.set(
        col.name,
        await buildSprite(col.icons, options.spriteOptions!, options.optimizeFiles!, logger),
      )
    }

    // ── Types: flat union of all icon ids (per-collection types in Phase 3) ───
    function buildIconTypes(cols: SpriteCollection[]): string {
      const allIds = cols.flatMap(c => c.icons.map(i => i.id))
      const typeStr = allIds.length === 0
        ? 'string'
        : allIds.map(id => JSON.stringify(id)).join(' | ')
      return `export type SvgIconName = ${typeStr}\n`
    }

    let iconTypesContent = buildIconTypes(collections)
    addTemplate({
      filename: 'nuxt-svgo-sprite/icon-names.d.ts',
      getContents: () => iconTypesContent,
      write: true,
    })

    // ── SvgUse generic component ────────────────────────────────────────────────
    const svgUseTemplate = addTemplate({
      filename: 'nuxt-svgo-sprite/SvgUse.vue',
      getContents: () => `<template>
  <svg v-bind="$attrs">
    <use :href="\`#\${name}\`" />
  </svg>
</template>

<script setup lang="ts">
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Nuxt resolves this alias in consumer app context.
import type { SvgIconName } from '#build/nuxt-svgo-sprite/icon-names'

defineOptions({ inheritAttrs: false })

export interface Props {
  name: SvgIconName
}

defineProps<Props>()
</script>
`,
      write: true,
    })
    addComponent({ name: 'SvgUse', filePath: svgUseTemplate.dst })

    // ── One sprite template + component per collection ──────────────────────────
    // Default collection → 'SvgSprite' for now (renamed to 'Sprite' in Phase 3).
    const spriteTemplateNames = new Map<string, string>()
    for (const col of collections) {
      const tplFilename = col.name === 'default'
        ? 'nuxt-svgo-sprite/SvgSprite.vue'
        : `nuxt-svgo-sprite/${col.spriteComponentName}.vue`
      const componentName = col.name === 'default' ? 'SvgSprite' : col.spriteComponentName

      spriteTemplateNames.set(col.name, tplFilename)

      const tpl = addTemplate({
        filename: tplFilename,
        getContents: () => `<template>${spriteContents.get(col.name) ?? ''}</template>`,
        write: true,
      })
      addComponent({ name: componentName, filePath: tpl.dst })
    }

    // ── Use* wrapper components ────────────────────────────────────────────────
    function registerUseComponent(icon: IconMeta): void {
      const tpl = addTemplate({
        filename: `nuxt-svgo-sprite/icons/${icon.id}.vue`,
        getContents: () => `<template><svg v-bind="$attrs"><use href="#${icon.id}"/></svg></template><script setup lang="ts">defineOptions({inheritAttrs: false})</script>`,
        write: true,
      })
      addComponent({ name: icon.componentName, filePath: tpl.dst })
    }

    if (options.createUseComponents) {
      for (const col of collections) {
        for (const icon of col.icons) {
          registerUseComponent(icon)
        }
      }
    }

    // ── Register types in consumer's tsconfig ───────────────────────────────────
    nuxt.hook('prepare:types', ({ references }) => {
      references.push({ path: path.resolve(nuxt.options.buildDir, 'nuxt-svgo-sprite/icon-names.d.ts') })
    })

    // ── Per-collection debounced watcher ────────────────────────────────────────
    setupWatcher(nuxt, collections, logger, async (collection, event, absPath) => {
      logger.info(`${event}: "${absPath}" – rebuilding collection "${collection.name}"…`)

      // Re-scan the entire tree so default/ subfolder changes are picked up correctly.
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
      iconTypesContent = buildIconTypes(updated)

      const tplName = spriteTemplateNames.get(collection.name)
      await updateTemplates({
        filter: t => t.filename === tplName || t.filename === 'nuxt-svgo-sprite/icon-names.d.ts',
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
