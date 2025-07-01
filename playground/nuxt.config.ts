import { defineNuxtConfig } from 'nuxt/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineNuxtConfig({
  modules: [
    resolve(__dirname, '../modules/nuxt-svgo-sprite/module.ts')
  ],
  devtools: false,
  svgoSprite: {
    inputDir: 'assets/icons', // Укажите путь к вашим иконкам
    outputDir: 'public/img', // Куда будет сгенерирован спрайт
    spriteName: 'custom-sprite',
    watch: true,
    svgoConfig: {
      plugins: [
        {
          name: 'preset-default',
          params: {
            overrides: {
              removeViewBox: false,
            },
          },
        },
      ],
    },
  },
  runtimeConfig: {
    public: {
      svgoSprite: {
        spriteName: 'custom-sprite'
      }
    }
  }
  // ... другие настройки playground
});