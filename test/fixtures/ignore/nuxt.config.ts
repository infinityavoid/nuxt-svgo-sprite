import NuxtSvgoSprite from '../../../src/module'

export default defineNuxtConfig({
  modules: [NuxtSvgoSprite],
  ignore: ['assets/icons/draft/**'],
  svgoSprite: {
    inputDir: './assets/icons',
  },
})
