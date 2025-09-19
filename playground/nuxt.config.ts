export default defineNuxtConfig({
  modules: ['nuxt-svgo-sprite'],
  ssr: true,
  devtools: { enabled: false },
  svgSprite: {
    inputDir:'/assets/icons',
    createUseComponents: false,
    optimizeFiles: false
  }
})