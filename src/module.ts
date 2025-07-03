/* eslint-disable @typescript-eslint/ban-ts-comment */
import { join } from 'node:path'
import * as fs from 'node:fs'
import {
  defineNuxtModule,
  addVitePlugin,
  extendWebpackConfig,
  createResolver,
  addComponentsDir,
  addComponent,
  addTemplate,
} from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'
import type { Config } from 'svgo'
import type { Config as SpriteConfig } from 'svg-sprite'
import { type SvgLoaderOptions, svgLoader } from './loaders/svgLoader'
import {type SvgSpriteLoaderOptions, svgSpriteLoader } from "./loaders/svgSpriter";
import { generateImportQueriesDts } from './gen'

export type { SvgLoaderOptions, SvgSpriteLoaderOptions }

/**
 * taken from: https://stackoverflow.com/a/8831937/3542461
 */
function hashCode(str: string) {
  let hash = 0
  for (let i = 0, len = str.length; i < len; i++) {
    const chr = str.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0 // Convert to 32bit integer
  }
  return hash
}

export const defaultSvgoConfig: Config = {
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          removeViewBox: false,
        },
      },
    },
    'removeDimensions',
    {
      name: 'prefixIds',
      params: {
        prefix(_, info) {
          return 'i' + hashCode(info.path)
        },
      },
    },
  ],
}

export const defaultSpriteConfig: SpriteConfig = {
  mode: {
    symbol: {
      render: {
        css: false,
        scss: false,
      },
      example: false,
    },
  },
  svg: {
    xmlDeclaration: false,
  }
}

export type ModuleOptions = SvgLoaderOptions & SvgSpriteLoaderOptions & {
  /** Defaults to `svgo` */
  componentPrefix?: string
  /** Generate TypeScript declaration for svg import queries (Vite.js only) */
  dts?: boolean
  global?: boolean
}

const nuxtSvgoSpriter: NuxtModule<ModuleOptions> = defineNuxtModule({
  meta: {
    name: 'nuxt-svgo-spriter',
    configKey: 'svgoSpriter',
    compatibility: {
      // Add -rc.0 due to issue described in https://github.com/nuxt/framework/issues/6699
      nuxt: '>=3.0.0-rc.0',
    },
  },
  defaults: {
    svgo: true,
    defaultImport: 'componentext',
    autoImportPath: './assets/icons/',
    svgoConfig: undefined,
    spriteConfig: undefined,
    global: true,
    customComponent: 'NuxtIcon',
    customSpriteComponent: 'SvgSprite',
    componentPrefix: 'svgo',
    dts: false,
    spriter: true,
    spriteOutputPath: './assets/output'
  },
  async setup(options, nuxt) {
    const { resolvePath, resolve } = createResolver(import.meta.url)

    addComponent({
      name: 'nuxt-icon',
      filePath: resolve('./runtime/components/nuxt-icon.vue'),
    })
    if(options.spriter){
      addComponent({
        name: 'SvgSprite',
        filePath: resolve('./runtime/components/SvgSprite.vue'),
      })
      addComponent({
        name: 'SvgUse',
        filePath: resolve('./runtime/components/SvgUse.vue'),
      })
      addVitePlugin(
        svgSpriteLoader({
          ...options,
          spriteConfig: options.spriteConfig || defaultSpriteConfig
        })
      )
    }
    addVitePlugin(
      svgLoader({
        ...options,
        svgoConfig: options.svgoConfig || defaultSvgoConfig
      })
    )

    if (options.autoImportPath) {
      const addIconComponentsDir = (path: string) => {
        if (fs.existsSync(path)) {
          addComponentsDir({
            path,
            global: options.global,
            extensions: ['svg'],
            prefix: options.componentPrefix || 'svgo',
            watch: true,
          })
        }
      }

      const iconPaths: string[] = []

      try {
        const iconPath = await resolvePath(options.autoImportPath)
        iconPaths.push(iconPath)
      } catch (e) {
        console.error('Error resolving module path:', e)
      }

      const appDir = nuxt.options.srcDir || nuxt.options.rootDir
      iconPaths.push(join(appDir, options.autoImportPath.replace(/^\.\//, '')))

      if (nuxt.options._layers) {
        for (const layer of nuxt.options._layers) {
          if (layer.config && layer.config.srcDir) {
            iconPaths.push(join(layer.config.srcDir, options.autoImportPath.replace(/^\.\//, '')))
          }
        }
      }

      iconPaths.forEach(addIconComponentsDir)
    }

    if (options.dts && ['@nuxt/vite-builder', 'vite'].includes(nuxt.options.builder as string)) {
      addTemplate({
        filename: 'types/nuxt-svgo.d.ts',
        getContents: () => generateImportQueriesDts(options),
      })

      // We need to override the default svg typing for vite
      // Moving our generated template before 'vite/client' reference (included in builder-env.d.ts file)
      // overrides the default import for '*.svg'
      // https://vite.dev/guide/features#client-types
      nuxt.hook('prepare:types', ({ references }) => {
        const builderEnvFilePath = resolve(nuxt.options.buildDir, 'types', 'builder-env.d.ts')
        const fileIndex = references.findIndex(
            (ref) => 'path' in ref && ref.path === builderEnvFilePath,
        )

        references.splice(fileIndex, 0, { path: 'types/nuxt-svgo.d.ts' })
      })
    }

    extendWebpackConfig((config) => {
      // @ts-ignore
      const svgRule = config.module.rules.find((rule) => rule.test.test('.svg'))
      // @ts-ignore
      svgRule.test = /\.(png|jpe?g|gif|webp)$/

      config.module.rules.push({
        test: /\.svg$/,
        use: [
          'vue-loader',
          {
            loader: 'vue-svg-loader',
            options: {
              svgo: false,
            },
          },
          options.svgo && {
            loader: 'svgo-loader',
            options: options.svgoConfig || defaultSvgoConfig,
          },
        ].filter(Boolean),
      })
    })
  },
})

export default nuxtSvgoSpriter