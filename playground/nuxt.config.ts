import { defineNuxtConfig } from 'nuxt/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineNuxtConfig({
  modules: [
    resolve(__dirname, '../src/module.ts')
  ],
  devtools: false,
  svgoSprite: {
    inputDir: 'assets/icons', // Укажите путь к вашим иконкам
    spriteName: 'custom-sprite',
    watch: true,
    svgoConfig: {
      plugins: [
        {
          name: 'preset-default'
        },
        'removeViewBox', // Добавьте removeViewBox как отдельный плагин
      ]
    }
  }
});