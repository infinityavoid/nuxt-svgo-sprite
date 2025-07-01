// playground/nuxt.config.ts
import { defineNuxtConfig } from 'nuxt/config'
import MyModule from '../src/module' // Путь к вашему модулю

export default defineNuxtConfig({
  modules: [
    MyModule,
  ],
  alias: { // Добавьте это
    '#my-module': '../nuxt-svgo-sprite/src' // Замените на правильный путь
  },
  svgSprite: {
    iconDir: 'assets/icons', // Опционально: настройте путь к иконкам
  },
  devtools: { enabled: false }
})