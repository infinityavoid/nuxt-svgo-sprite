import { defineNuxtConfig } from 'nuxt/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineNuxtConfig({
  modules: [
    resolve(__dirname, '../src/module')
  ],
  svgSprite: {
    inputDir: 'assets/icons',
    svgoOptions: {},
    spriteOptions: {}
  },
});