export default defineNuxtConfig({
  modules: ['nuxt-svgo-sprite'],
  devtools: { enabled: true },
  compatibilityDate: 'latest',

  svgoSprite: {
    inputDir: './assets/icons',
    createUseComponents: true,
    componentPrefix: 'Icon',
    optimizeFiles: true,
  },
})
