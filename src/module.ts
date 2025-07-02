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
import SVGSpriter from 'svg-sprite';

function hashCode(str) {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash;
}

export default defineNuxtModule({
  meta: {
    name: 'nuxt-svgo-sprite',
    configKey: 'svgSprite'
  },
  defaults: {
    inputDir: 'svg',
    svgoOptions: {},
    spriteOptions: {},
    componentName: 'SvgSprite' // Имя компонента для спрайта
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);

    // 1. Add components
    addComponent({
      name: 'SvgUse',
      filePath: resolver.resolve('runtime/components/SvgUse.vue'), // Предполагается, что этот компонент существует
      global: true
    });

    // Prepare sprite
    const inputDir = path.resolve(nuxt.options.srcDir, options.inputDir);

    try {
      await fs.access(inputDir);
    } catch (e) {
      console.warn(`[nuxt-svgo-sprite] Input directory "${inputDir}" does not exist. Skipping sprite generation.`);
      return;
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
        },
        ...options.spriteOptions
      },
      svg: {
        xmlDeclaration: false
      },
    });

    for (const file of files) {
      if (file.endsWith('.svg')) {
        const filePath = path.join(inputDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const optimized = optimize(content, { path: filePath, ...options.svgoOptions }).data;
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

    // 2. Create a template file using addTemplate
    const templateResult = addTemplate({
      filename: `components/${options.componentName}.vue`,
      getContents: () =>`<template>${spriteContent}</template>`,
    });
    console.log(templateResult)

    // 3. Add component using components:extend hook
    nuxt.hook('components:extend', (components) => {
      const componentName = options.componentName;
      const kebabName = componentName.replace(/([A-Z])/g, '-$1').toLowerCase();
      const pascalName = componentName.charAt(0).toUpperCase() + componentName.slice(1);

      components.push({
        name: componentName,
        pascalName: pascalName,
        kebabName: kebabName,
        export: 'default',
        filePath: templateResult.dst, // Use the path from addTemplate
        global: true,
      });
    });

    console.log('[nuxt-svgo-sprite] SVG sprite component registered successfully!');
  }
});