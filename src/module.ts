import {
  defineNuxtModule,
  createResolver,
  addVitePlugin,
  addComponent,
    addTemplate
} from '@nuxt/kit';
import { optimize } from 'svgo';
import { promises as fs } from 'fs';
import path from 'path';
import { type SpriteGeneratorOptions, svgSpriteGenerator } from './loaders/spriteGenerator'
import { type SVGoptimizeOptions, svgOptimize } from "./loaders/svgOptimize";
import SVGSprite, { Config } from 'svg-sprite';

function hashCode(str) {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash;
}

export const defaultSvgoConfig: svgoConfig = {
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

export type ModuleOptions = SvgLoaderOptions & SvgSpriteLoaderOptions

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
    svgoOptions: undefined,
    spriteOptions: undefined
  },
  async setup(options, nuxt) {
    const { resolvePath, resolve } = createResolver(import.meta.url)
    const appDir = nuxt.options.srcDir || nuxt.options.rootDir
    const iconPath = appDir + options.inputDir
    try {
      await fs.access(iconPath);
    } catch (e) {
      console.warn(`[nuxt-svgo-sprite] Input directory "${iconPath}" does not exist. Skipping sprite generation.`);
      return;
    }
    // 1. Add components
    addComponent({
      name: 'svgUse',
      filePath: resolve('./runtime/components/svgUse.vue')
    });
    // optimizing svg files

    const files = await fs.readdir(iconPath);

    const spriter = new SVGSprite(options.spriteOptions || defaultSpriteConfig);

    for (const file of files) {
      if (file.endsWith('.svg')) {
        const filePath = path.join(iconPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const optimized = optimize(content, { path: filePath, ...options.svgoOptions || defaultSvgoConfig }).data;
        spriter.add(filePath, null, optimized);
      }
    }

    const { result } = await spriter.compileAsync();
    let spriteContent = '';

    for (let mode in result) {
      for (let resource in result[mode]) {
        spriteContent = result[mode][resource].contents.toString();
      }
    }
    console.log(spriteContent)

    // 2. Create a template file using addTemplate
    const templateResult = addTemplate({
      filename: `components/svgSprite.vue`,
      getContents: () =>`<template>${spriteContent}</template>`,
    });
    console.log(templateResult.getContents())

    // 1. Add components
    addComponent({
      name: 'svgSprite',
      filePath: resolve('./runtime/components/svgSprite.vue')
    });

    console.log('[nuxt-svgo-sprite] SVG sprite component registered successfully!');
  }
});

export default nuxtSvgoSpriter