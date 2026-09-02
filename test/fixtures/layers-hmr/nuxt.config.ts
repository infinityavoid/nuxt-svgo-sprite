import NuxtSvgoSprite from '../../../src/module'

export default defineNuxtConfig({
  extends: ['./base-layer'],
  modules: [NuxtSvgoSprite],
  svgoSprite: {
    inputDir: '~/assets/icons',
    createUseComponents: true,
    autoInjectSprite: true,
  },
})
