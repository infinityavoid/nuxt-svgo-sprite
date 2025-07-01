import {
  defineNuxtModule,
  addVitePlugin,
  extendWebpackConfig,
  createResolver,
  addComponentsDir,
  addComponent,
  addTemplate,
} from '@nuxt/kit'
import { optimize } from 'svgo';
import { promises as fs } from 'fs';
import path from 'path';
import SVGSpriter from 'svg-sprite';
import { ModuleOptions } from './types';


export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-svgo-sprite',
    configKey: 'svgSprite'
  },
  defaults: {
    inputDir: 'svg',
    svgoOptions: {},
    spriteOptions: {}
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    const svgUseComponentName = 'SvgUse';
    const svgSpriteComponentName = 'SvgSprite';

    // 1. Add components
    addComponent({
      name: svgUseComponentName,
      filePath: resolver.resolve('runtime/components/SvgUse.vue'),
      global: true
    })

    // 2. Transpile runtime directory
    nuxt.options.build.transpile.push(resolver.resolve('runtime'))

    // 4. Hook to generate sprite before build
    nuxt.hook('build:before', async () => {
      const inputDir = path.resolve(nuxt.options.srcDir, options.inputDir);

      try {
        await fs.access(inputDir);
      } catch (e) {
        console.warn(`[nuxt-svgo-sprite] Input directory "${inputDir}" does not exist. Skipping sprite generation.`);
        return
      }

      const files = await fs.readdir(inputDir);

      const spriter = new SVGSpriter({
        mode: {
          symbol: {
            render: {
              css: false,
              scss: false
            },
            example: false
          }
        },
        ...options.spriteOptions
      });

      for (const file of files) {
        if (file.endsWith('.svg')) {
          const filePath = path.join(inputDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const optimized = optimize(content, { path: filePath, ...options.svgoOptions }).data;
          spriter.add(filePath, null, optimized);
        }
      }

      await new Promise((resolve, reject) => {
        spriter.compile(async (error, result) => {
          if (error) {
            console.error(error);
            reject(error);
          } else {
            let spriteContent = '';

            for (let mode in result) {
              for (let resource in result[mode]) {
                spriteContent = result[mode][resource].contents.toString();
              }
            }

            // Define the component file path in the components directory
            const componentFilePath = path.join(componentsDir, `${svgSpriteComponentName}.vue`);

            // Write the component file
            await fs.writeFile(componentFilePath, `<template>${spriteContent}</template>`);

            addComponent({
              name: svgSpriteComponentName,
              filePath: componentFilePath,
              global: true
            });

            console.log(`[nuxt-svgo-sprite] Component created at: ${componentFilePath}`);
            console.log('[nuxt-svgo-sprite] SVG sprite generated successfully!');
            resolve();
          }
        });
      });
    })
  }
})