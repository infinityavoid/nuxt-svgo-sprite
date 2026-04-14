import {
  defineNuxtModule,
  addComponent,
  addTemplate,
  updateTemplates,
} from '@nuxt/kit'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import SVGSprite, { type Config as SpriteConfig } from 'svg-sprite'

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

export const defaultSpriteConfig: SpriteConfig = {
  mode: {
    symbol: {
      render: { css: false, scss: false },
      example: false,
    },
  },
  shape: {
    transform: ['svgo'],
  },
  svg: {
    xmlDeclaration: false,
    rootAttributes: {
      'aria-hidden': 'true',
      'style': 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;',
    },
  },
}

export interface ModuleOptions {
  /**
   * Source directory for SVG files, relative to `srcDir`.
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
   * Custom svg-sprite configuration that *replaces* the built-in defaults.
   * Omit to use symbol mode with no CSS/SCSS output.
   */
  spriteOptions?: SpriteConfig
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-svgo-sprite',
    configKey: 'svgoSprite',
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
    const srcDir = nuxt.options.srcDir
    const iconDir = path.join(srcDir, options.inputDir!)

    try {
      await fs.access(iconDir)
    }
    catch {
      console.warn(
        `[nuxt-svgo-sprite] Input directory "${iconDir}" not found – sprite generation skipped.`,
      )
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

    async function buildSprite(): Promise<string> {
      const svgFiles = await getSvgFiles()

      if (svgFiles.length === 0) {
        console.warn('[nuxt-svgo-sprite] No .svg files found in input directory.')
        return ''
      }

      const baseSpriteConfig = options.spriteOptions ?? defaultSpriteConfig
      const spriteConfig: SpriteConfig = (options.optimizeFiles ?? true)
        ? baseSpriteConfig
        : {
            ...baseSpriteConfig,
            shape: {
              ...baseSpriteConfig.shape,
              transform: [],
            },
          }
      const spriter = new SVGSprite(spriteConfig)

      for (const file of svgFiles) {
        const filePath = path.join(iconDir, file)
        const raw = await fs.readFile(filePath, 'utf-8')
        spriter.add(filePath, null, raw)
      }

      const { result } = await spriter.compileAsync()

      for (const mode in result) {
        for (const resource in result[mode]) {
          return (result[mode][resource] as { contents: Buffer }).contents.toString()
        }
      }

      return ''
    }

    const initialSvgFiles = await getSvgFiles()
    let iconTypesContent = buildIconTypes(getIconNames(initialSvgFiles))

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

    let spriteContent = await buildSprite()

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
      const svgFiles = await getSvgFiles()

      for (const file of svgFiles) {
        const iconName = path.basename(file, '.svg')
        const pascalName = toPascalCase(iconName)
        const componentName = `${options.componentPrefix}${pascalName}`

        const tpl = addTemplate({
          filename: `nuxt-svgo-sprite/icons/${iconName}.vue`,
          getContents: () => `<template><svg v-bind="$attrs"><use href="#${iconName}"/></svg></template><script setup lang="ts">defineOptions({inheritAttrs: false})</script>`,
          write: true,
        })

        addComponent({ name: componentName, filePath: tpl.dst })
      }
    }

    nuxt.hook('builder:watch', async (event, relativePath) => {
      const absPath = path.resolve(nuxt.options.rootDir, relativePath)

      if (!absPath.startsWith(iconDir)) return
      if (!relativePath.endsWith('.svg')) return

      console.log(
        `[nuxt-svgo-sprite] ${event}: "${relativePath}" – rebuilding sprite…`,
      )

      spriteContent = await buildSprite()
      iconTypesContent = buildIconTypes(getIconNames(await getSvgFiles()))

      await updateTemplates({
        filter: t =>
          t.filename === 'nuxt-svgo-sprite/SvgSprite.vue'
          || t.filename === 'nuxt-svgo-sprite/icon-names.d.ts',
      })
    })

    const count = (await getSvgFiles()).length
    console.log(`[nuxt-svgo-sprite] Sprite built (${count} icon${count !== 1 ? 's' : ''}).`)
  },
})
