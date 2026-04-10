import {
  defineNuxtModule,
  createResolver,
  addComponent,
  addTemplate,
  useLogger,
  updateTemplates,
} from '@nuxt/kit'
import { optimize, type Config as SVGOConfig } from 'svgo'
import { promises as fs } from 'fs'
import path from 'path'

const logger = useLogger('nuxt-svgo-sprite')

function hashCode(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }
  return 'i' + Math.abs(hash).toString(36)
}

export const defaultSvgoConfig: SVGOConfig = {
  plugins: [
    { name: 'preset-default' },
    'removeDimensions',
    {
      name: 'prefixIds',
      params: {
        prefix(_, info) {
          return hashCode(info.path)
        },
      },
    },
  ],
}

export interface ModuleOptions {
  /**
   * The directory where SVG files are located for optimization and sprite creation.
   * @default './assets/icons'
   */
  inputDir: string

  /**
   * Determines whether to create individual Vue components per icon using the `<use>` tag.
   * @default false
   * @example inputDir/myIcon.svg -> `<UseMyIcon/>`
   */
  createUseComponents: boolean

  /**
   * The prefix used for the names of the generated Vue components.
   * @default 'Use'
   * @example componentPrefix: 'Icon' -> inputDir/myIcon.svg -> `<IconMyIcon/>`
   */
  componentPrefix: string

  /**
   * Whether to optimize SVG files with SVGO before creating the sprite.
   * @default true
   */
  optimizeFiles: boolean

  /**
   * Custom SVGO configuration. When provided, replaces the default config entirely.
   */
  svgoOptions?: SVGOConfig
}

interface SvgSymbol {
  id: string
  viewBox: string
  inner: string
}

/**
 * Extracts viewBox and inner content from an SVG string.
 * Handles XML declarations, doctypes, and multi-attribute opening tags.
 */
function extractSvgParts(content: string): Omit<SvgSymbol, 'id'> | null {
  // Strip XML declaration and DOCTYPE
  content = content
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trim()

  const svgStart = content.toLowerCase().indexOf('<svg')
  if (svgStart === -1) return null

  // Walk character-by-character to find the real end of the opening tag,
  // correctly handling attribute values that may contain '>'
  let i = svgStart + 4
  let inStr = false
  let strChar = ''
  while (i < content.length) {
    const ch = content[i]
    if (inStr) {
      if (ch === strChar) inStr = false
    } else if (ch === '"' || ch === "'") {
      inStr = true
      strChar = ch
    } else if (ch === '>') {
      break
    }
    i++
  }

  const openTag = content.slice(svgStart, i + 1)
  const viewBoxMatch = openTag.match(/viewBox\s*=\s*["']([^"']+)["']/i)
  const closeIndex = content.lastIndexOf('</svg>')
  if (closeIndex === -1) return null

  return {
    viewBox: viewBoxMatch?.[1] ?? '',
    inner: content.slice(i + 1, closeIndex).trim(),
  }
}

function buildSpriteHtml(symbols: SvgSymbol[]): string {
  const parts = symbols.map(({ id, viewBox, inner }) => {
    const vbAttr = viewBox ? ` viewBox="${viewBox}"` : ''
    return `<symbol id="${id}"${vbAttr}>${inner}</symbol>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="display:none">\n${parts.join('\n')}\n</svg>`
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-svgo-sprite',
    configKey: 'svgSprite',
    compatibility: { nuxt: '>=3.0.0' },
  },
  defaults: {
    inputDir: './assets/icons',
    createUseComponents: false,
    componentPrefix: 'Use',
    optimizeFiles: true,
  },
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const appDir = nuxt.options.srcDir || nuxt.options.rootDir
    const iconPath = path.join(appDir, options.inputDir)

    try {
      await fs.access(iconPath)
    } catch {
      logger.warn(`Input directory "${iconPath}" does not exist. Skipping sprite generation.`)
      return
    }

    const svgoConfig = options.svgoOptions ?? defaultSvgoConfig

    async function compileSprite(): Promise<{ spriteContent: string; svgFiles: string[] }> {
      const entries = await fs.readdir(iconPath, { withFileTypes: true })
      const svgFiles = entries
        .filter(e => e.isFile() && e.name.endsWith('.svg'))
        .map(e => e.name)

      const symbols = (
        await Promise.all(
          svgFiles.map(async (file): Promise<SvgSymbol | null> => {
            const filePath = path.join(iconPath, file)
            const raw = await fs.readFile(filePath, 'utf-8')
            const processed = options.optimizeFiles
              ? optimize(raw, { path: filePath, ...svgoConfig }).data
              : raw

            const parts = extractSvgParts(processed)
            if (!parts) {
              logger.warn(`Failed to parse "${file}", skipping.`)
              return null
            }

            return { id: path.basename(file, '.svg'), ...parts }
          }),
        )
      ).filter((s): s is SvgSymbol => s !== null)

      return { spriteContent: buildSpriteHtml(symbols), svgFiles }
    }

    let { spriteContent, svgFiles } = await compileSprite()

    // Generic <SvgUse symbol="..." /> component (when individual components are not generated)
    if (!options.createUseComponents) {
      addComponent({
        name: 'SvgUse',
        filePath: resolve('./runtime/components/svgUse.vue'),
      })
    }

    // Write sprite to .nuxt virtual directory and register as <SvgSprite />
    const spriteTemplate = addTemplate({
      filename: 'nuxt-svgo-sprite/SvgSprite.vue',
      getContents: () => `<template>${spriteContent}</template>`,
      write: true,
    })

    addComponent({
      name: 'SvgSprite',
      filePath: spriteTemplate.dst,
    })

    // Optionally generate individual <UseFoo /> / <IconFoo /> components per icon
    if (options.createUseComponents) {
      for (const file of svgFiles) {
        const id = path.basename(file, '.svg')
        const name = options.componentPrefix + id[0].toUpperCase() + id.slice(1)
        const tpl = addTemplate({
          filename: `nuxt-svgo-sprite/${id}.vue`,
          getContents: () => `<template>
  <svg :class="svgClass"><use href="#${id}" /></svg>
</template>
<script setup lang="ts">
defineProps<{ svgClass?: string | string[] }>()
</script>`,
          write: true,
        })
        addComponent({ name, filePath: tpl.dst })
      }
    }

    // HMR: rebuild sprite when any SVG in the icon directory changes
    if (nuxt.options.dev) {
      nuxt.hook('builder:watch', async (_event, watchedPath) => {
        const absPath = path.resolve(nuxt.options.rootDir, watchedPath)
        const absIconPath = path.resolve(iconPath)
        if (!absPath.startsWith(absIconPath) || !absPath.endsWith('.svg')) return

        logger.info('SVG changed, rebuilding sprite...')
        ;({ spriteContent } = await compileSprite())
        await updateTemplates({
          filter: t => t.filename === 'nuxt-svgo-sprite/SvgSprite.vue',
        })
      })
    }

    logger.success(`SVG sprite ready (${svgFiles.length} icon${svgFiles.length !== 1 ? 's' : ''}).`)
  },
})
