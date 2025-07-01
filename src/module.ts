import { fileURLToPath } from 'url'
import { defineNuxtModule, addPlugin, createResolver, addVitePlugin, addPublicDir, addComponentsDir } from '@nuxt/kit'
import { name, version } from '../package.json'
import { generateSvgSprite } from './utils/generateSvgSprite'

export interface ModuleOptions {
    // Добавьте здесь опции модуля
    iconDir?: string; // Путь к каталогу с SVG-файлами
}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name,
        version,
        configKey: 'svgSprite', // Ключ для конфигурации в nuxt.config.ts
    },
    defaults: {
        iconDir: 'assets/icons', // Путь по умолчанию
    },
    async setup(options, nuxt) {
        const resolver = createResolver(import.meta.url)

        // 1. Register `SvgSprite` component (see below)
        addPlugin(resolver.resolve('./runtime/plugin.mjs'), {  // Changed to mjs
            iconDir: options.iconDir,
        })

        // 2. Add components directory
        addComponentsDir({
            path: resolver.resolve('./components'),
            prefix: 'Icon' // Optional: add prefix to components
        })

        // 3. Build before build (generate sprite)
        nuxt.hook('build:before', async () => {
            await generateSvgSprite(options, resolver, nuxt)
        })
    }
})