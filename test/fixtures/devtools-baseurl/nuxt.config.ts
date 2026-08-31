import NuxtSvgoSprite from '../../../src/module'

export default defineNuxtConfig({
  modules: [NuxtSvgoSprite],
  app: {
    baseURL: '/my-app/',
  },
  svgoSprite: {
    inputDir: './assets/icons',
  },
})
