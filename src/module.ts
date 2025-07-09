import {
  defineNuxtModule,
  createResolver,
  addComponent,
  addTemplate
} from '@nuxt/kit';
import { optimize, Config as SVGOConfig } from 'svgo';
import { promises as fs } from 'fs';
import type { NuxtModule } from '@nuxt/schema'
import path from 'path';
import SVGSprite, { Config as SpriteConfig } from 'svg-sprite';

function hashCode(str: String) {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash;
}

export const defaultSvgoConfig: SVGOConfig = {
  plugins: [
    {
      name: 'preset-default'
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

export type ModuleOptions = SVGOConfig & SpriteConfig & {
  /**
   *  The directory where SVG files are located for optimization and sprite creation.
   *  @default './assets/icons'
   */
  inputDir: string;

  /**
   *  Determines whether to create Vue components for using sprites via the `<use>` tag.
   *  If `true`, components will be created to simplify using icons from the sprite.
   *  @default false
   *  @example inputDir/myIcon.svg -> `<useMyIcon/>`
   */
  createUseComponents: boolean;

  /**
   *  The prefix used for the names of the generated Vue components (if `createUseComponents` is set to `true`).
   *  Components will be named `<componentPrefix><icon_name>`.
   *  @default 'use'
   *  @example for componentPrefix: 'Icon' -> inputDir/myIcon.svg -> `<IconMyIcon/>`
   */
  componentPrefix: string;

  /**
   *  Determines whether to optimize SVG files with SVGO before creating the sprite.
   *  It is recommended to leave this enabled to reduce file size and improve performance.
   *  @default true
   */
  optimizeFiles: boolean;
}

const nuxtSvgoSpriter: NuxtModule<ModuleOptions> = defineNuxtModule({
  meta: {
    name: 'nuxt-svgo-sprite',
    configKey: 'svgSprite',
    compatibility: {
      // Add -rc.0 due to issue described in https://github.com/nuxt/framework/issues/6699
      nuxt: '>=3.0.0-rc.0',
    },
  },
  defaults: {
    inputDir: './assets/icons',
    createUseComponents: false,
    componentPrefix: 'use',
    optimizeFiles: true,
    svgoOptions: undefined,
    spriteOptions: undefined
  },
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const appDir = nuxt.options.srcDir || nuxt.options.rootDir
    const iconPath = appDir + options.inputDir

    // 1. Checking if directory exists
    try {
      await fs.access(iconPath);
    } catch (e) {
      console.warn(`[nuxt-svgo-sprite] Input directory "${iconPath}" does not exist. Skipping sprite generation.`);
      return;
    }

    // 2. Creating universal component for use symbols
    if(!options.createUseComponents){
      addComponent({
        name: 'svgUse',
        filePath: resolve('./runtime/components/svgUse.vue')
      });
    }

    // 3. Getting all files from directory
    const files = await fs.readdir(iconPath);

    // 4. Initialize SVGSprite
    const spriter = new SVGSprite(options.spriteOptions || defaultSpriteConfig);

    // 5. Adding files to spriter
    for (const file of files) {
      if (file.endsWith('.svg')) {
        const filePath = path.join(iconPath, file);
        const content = await fs.readFile(filePath, 'utf-8');

        const svgContent = options.optimizeFiles
            ? optimize(content, { path: filePath, ...options.svgoOptions || defaultSvgoConfig }).data
            : content;

        spriter.add(filePath, null, svgContent);
      }
    }

    // 6. Compile sprite for all svg files
    const { result } = await spriter.compileAsync();

    // 7. Get content from compile data
    let spriteContent = '';

    for (let mode in result) {
      for (let resource in result[mode]) {
        spriteContent = result[mode][resource].contents.toString();
      }
    }

    // 8. Adding content to runtime template
    addTemplate({
      filename: resolve(`./runtime/components/svgSprite.vue`),
      getContents: () =>`<template>${spriteContent}</template>`,
    });

    // 9. Adding component
    addComponent({
      name: 'svgSprite',
      filePath: resolve('./runtime/components/svgSprite.vue')
    });

    // 10. Creating use components if needed
    if (options.createUseComponents) {
      for (const file of files) {
        if (file.endsWith('.svg')) {
          const fileName = path.basename(file, '.svg');
          // 11. Create a template for the wrapper component
          addTemplate({
            filename: resolve(`./runtime/components/${fileName}.vue`),
            getContents: () => `
              <template>
                <svg :class="svgClass" :width="width" :height="height" :aria-hidden="ariaHidden">
                  <use href="#${fileName}" />
                </svg>
              </template>
              
              <script setup lang="ts">
              export interface Props {
                /**
                 * The id of the symbol to use from the sprite.
                 */
                symbol: string;
                /**
                 * Css class(es) to apply to the svg.
                 */
                svgClass?: string | string[];
                /**
                 * Style to apply to the svg.
                 */
                svgStyle?: object;
                /**
                 * Width of the svg.
                 */
                width?: string | number;
                /**
                 * Height of the svg.
                 */
                height?: string | number;
              
                ariaHidden?: boolean
              }
              defineProps<Props>()
              </script>
            `
          });

          // 12. Register component
          addComponent({
            name: options.componentPrefix + fileName[0].toUpperCase() + fileName.slice(1),
            filePath: resolve(`./runtime/components/${fileName}.vue`),
          });
        }
      }
    }

    console.log('[nuxt-svgo-sprite] SVG sprite component registered successfully!');
  }
});

export default nuxtSvgoSpriter