import NuxtSvgoSprite from '../../../src/module'

export default defineNuxtConfig({
  modules: [NuxtSvgoSprite],
  svgoSprite: {
    inputDir: './assets/icons',
  },
})
