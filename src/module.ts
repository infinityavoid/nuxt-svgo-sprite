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
import { debounce } from 'perfect-debounce'
import { version } from '../package.json'
import { defaultSpriteConfig, buildSprite } from './builders/sprite-builder'
import type { IconMeta } from './types/types'

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

export interface ModuleOptions {
  /**
   * Source directory for SVG files. Resolved via `resolvePath`, so `~` aliases work.
   * @default './assets/icons'
   */
  inputDir?: string

  /**
   * Auto-generate a thin wrapper component for each SVG icon.
   * When `true`, a file `arrow.svg` becomes `<UseArrow />` (prefix configurable).
   * @default false
   */
  createUseComponents?: boolean

  /**
   * Prefix applied to the name of every generated per-icon component.
   * @default 'use'
   * @example 'Icon' → `<IconArrow />`
   */
  componentPrefix?: string

  /**
   * Run SVGO on every SVG file before adding it to the sprite.
   * @default true
   */
  optimizeFiles?: boolean

  /**
   * Custom svg-sprite configuration, deep-merged over the built-in defaults by Nuxt.
   * Omit to use symbol mode with no CSS/SCSS output.
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

    async function getSvgFiles(): Promise<string[]> {
      const entries = await fs.readdir(iconDir)
      return entries.filter(f => f.endsWith('.svg'))
    }

    function getIconNames(svgFiles: string[]): string[] {
      return svgFiles.map(file => path.basename(file, '.svg'))
    }

    function buildIconTypes(iconNames: string[]): string {
      const iconNameType = iconNames.length === 0
        ? 'string'
        : iconNames.map(name => JSON.stringify(name)).join(' | ')

      return `export type SvgIconName = ${iconNameType}\n`
    }

    // Construct minimal IconMeta objects from a flat list of filenames.
    // In Phase 2 this is replaced by the full collection builder which uses buildIconMeta().
    function filesToIcons(svgFiles: string[]): IconMeta[] {
      return svgFiles.map(file => ({
        id: path.basename(file, '.svg'),
        componentName: '',
        absolutePath: path.join(iconDir, file),
      }))
    }

    function registerUseComponent(iconName: string): void {
      const componentName = `${options.componentPrefix}${toPascalCase(iconName)}`
      const tpl = addTemplate({
        filename: `nuxt-svgo-sprite/icons/${iconName}.vue`,
        getContents: () => `<template><svg v-bind="$attrs"><use href="#${iconName}"/></svg></template><script setup lang="ts">defineOptions({inheritAttrs: false})</script>`,
        write: true,
      })
      addComponent({ name: componentName, filePath: tpl.dst })
    }

    // Single scan — reused for types, sprite, use-components, and count (#2)
    const svgFiles = await getSvgFiles()

    let iconTypesContent = buildIconTypes(getIconNames(svgFiles))

    addTemplate({
      filename: 'nuxt-svgo-sprite/icon-names.d.ts',
      getContents: () => iconTypesContent,
      write: true,
    })

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

    addComponent({
      name: 'SvgUse',
      filePath: svgUseTemplate.dst,
    })

    let spriteContent = await buildSprite(
      filesToIcons(svgFiles),
      options.spriteOptions!,
      options.optimizeFiles!,
      logger,
    )

    const spriteTemplate = addTemplate({
      filename: 'nuxt-svgo-sprite/SvgSprite.vue',
      getContents: () => `<template>${spriteContent}</template>`,
      write: true,
    })

    addComponent({
      name: 'SvgSprite',
      filePath: spriteTemplate.dst,
    })

    if (options.createUseComponents) {
      for (const file of svgFiles) {
        registerUseComponent(path.basename(file, '.svg'))
      }
    }

    // Register generated types in consumer's tsconfig (#22)
    nuxt.hook('prepare:types', ({ references }) => {
      references.push({ path: path.resolve(nuxt.options.buildDir, 'nuxt-svgo-sprite/icon-names.d.ts') })
    })

    // Debounced watcher: coalesces rapid file changes; registers new Use components on add (#19, #1)
    nuxt.hook('builder:watch', debounce(async (event, relativePath) => {
      const absPath = path.resolve(nuxt.options.rootDir, relativePath)

      if (!absPath.startsWith(iconDir)) return
      if (!relativePath.endsWith('.svg')) return

      logger.info(`${event}: "${relativePath}" – rebuilding sprite…`)

      const currentFiles = await getSvgFiles()
      spriteContent = await buildSprite(
        filesToIcons(currentFiles),
        options.spriteOptions!,
        options.optimizeFiles!,
        logger,
      )
      iconTypesContent = buildIconTypes(getIconNames(currentFiles))

      await updateTemplates({
        filter: t =>
          t.filename === 'nuxt-svgo-sprite/SvgSprite.vue'
          || t.filename === 'nuxt-svgo-sprite/icon-names.d.ts',
      })

      if (event === 'add' && options.createUseComponents) {
        const iconName = path.basename(relativePath, '.svg')
        registerUseComponent(iconName)
        logger.info(`Registered new component <${options.componentPrefix}${toPascalCase(iconName)} />.`)
      }
    }, 100))

    logger.info(`Sprite built (${svgFiles.length} icon${svgFiles.length !== 1 ? 's' : ''}).`)
  },
})
