import { defineNuxtModule, addPlugin, createResolver, useNuxt } from '@nuxt/kit';
import defu from 'defu';
import { join, resolve } from 'path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs'; // Correct import
import { glob } from 'fast-glob';
import chokidar from 'chokidar';
import { createSvgSprite } from './utils';
import { ModuleOptions, ModuleMeta } from './types';
import { consola } from 'consola';
import { optimize } from 'svgo'; // Импортируем функцию optimize из svgo

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
    outputDir: 'assets/svg',
    spriteName: 'sprite',
    svgoConfig: {},
    watch: true,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);
    const moduleOptions = defu(options, {
      inputDir: 'assets/svg',
      outputDir: 'assets/svg',
      spriteName: 'sprite',
      svgoConfig: {},
      watch: true,
    });

    const inputDirPath = resolve(nuxt.options.rootDir, moduleOptions.inputDir);
    const outputDirPath = resolve(nuxt.options.rootDir, moduleOptions.outputDir);

    // Create output directory if it doesn't exist
    if (!existsSync(outputDirPath)) {
      await mkdir(outputDirPath, { recursive: true });
    }

    // Hook build:before to process SVGs
    nuxt.hook('build:before', async () => {
      await processSVGs(moduleOptions, nuxt, inputDirPath, outputDirPath);
    });

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
          await processSVGs(moduleOptions, nuxt, inputDirPath, outputDirPath);
        }
      });

      nuxt.hook('close', () => {
        watcher.close();
      });
    }

    // Add SvgIcon component (or another way to provide the sprite)
    addPlugin(resolver.resolve('./runtime/plugin'), {
      options: moduleOptions,
    });
  },
});

async function processSVGs(options: ModuleOptions, nuxt: any, inputDirPath: string, outputDirPath: string) {
  try {
    const svgFiles = await glob('*.svg', { cwd: inputDirPath, absolute: true });
    const optimizedSvgs: { [key: string]: string } = {};

    for (const svgFile of svgFiles) {
      try {
        const svgContent = await readFile(svgFile, 'utf-8');
        console.log("svgContent:", svgContent);
        console.log("options.svgoConfig:", options.svgoConfig);

        // Оптимизируем SVG с помощью svgo
        const optimizedSvg = optimize(svgContent, {
          path: svgFile,
          ...options.svgoConfig,
        });

        console.log("optimizedSvg:", optimizedSvg);

        if (optimizedSvg.error) {
          consola.error(`SVGO Error processing ${svgFile}:`, optimizedSvg.error);
          continue;
        }

        optimizedSvgs[svgFile] = optimizedSvg.data;
      } catch (error: any) {
        consola.error(`Error processing ${svgFile}:`, error.message);
      }
    }

    const spriteContent = createSvgSprite(optimizedSvgs, options);
    const outputPath = join(outputDirPath, `${options.spriteName}.svg`);

    try {
      await writeFile(outputPath, spriteContent);
      consola.success(`SVG sprite generated at: ${outputPath}`);
    } catch (error: any) {
      consola.error(`Error writing sprite file:`, error.message);
    }
  } catch (error: any) {
    consola.error('An unexpected error occurred:', error);
  }
}