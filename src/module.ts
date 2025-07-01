// modules/nuxt-svgo-sprite/module.ts
import {createResolver, defineNuxtModule} from '@nuxt/kit';
import defu from 'defu';
import {resolve} from 'path';
import {glob} from 'fast-glob';
import chokidar from 'chokidar';
import {ModuleOptionsType} from './types';
import {consola} from 'consola';
import {svgSpriteLoader} from './loaders/vite'; // Импортируйте svgSpriteLoader

export default defineNuxtModule({
  meta: {
    name: 'nuxt-svgo-sprite',
    configKey: 'svgoSprite',
    compatibility: {
      nuxt: '^3.0.0',
    },
  },
  defaults: {
    inputDir: 'assets/svg',
    spriteName: 'sprite',
    svgoConfig: {},
    watch: true,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);
    const moduleOptions = defu(options, {
      inputDir: 'assets/svg',
      spriteName: 'sprite',
      svgoConfig: {},
      watch: true,
    });

    const inputDirPath = resolve(nuxt.options.rootDir, moduleOptions.inputDir);
    // Hook build:before to process SVGs
    nuxt.hook('build:before', async () => {
      await processSVGs(moduleOptions, nuxt, inputDirPath);
    });
    // Watching only in dev
    if(!import.meta.client){
      return
    }

    // Watch for file changes (if watch is enabled)
    if (moduleOptions.watch) {
      const watcher = chokidar.watch(inputDirPath, {
        ignored: ['**/sprite.svg'],
        persistent: true,
        usePolling: false,
      });

      watcher.on('all', async (event, path) => {
        if (['add', 'change', 'unlink'].includes(event)) {
          consola.info(`SVG file ${event}: ${path}`);
          await processSVGs(moduleOptions, nuxt, inputDirPath);
        }
      });

      nuxt.hook('close', () => {
        watcher.close();
      });
    }
  },
});

async function processSVGs(options: ModuleOptionsType, nuxt: any, inputDirPath: string) {
  try {
    const svgFiles = await glob('*.svg', { cwd: inputDirPath, absolute: true });

    // Use svgSpriteLoader to generate the sprite component
    // Return the component code
    return await svgSpriteLoader(svgFiles, {
      svgoConfig: options.svgoConfig,
      spriteName: options.spriteName,
    });

  } catch (error: any) {
    consola.error('An unexpected error occurred:', error);
  }
}