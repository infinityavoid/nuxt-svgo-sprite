export default defineNuxtConfig({
  modules: ['nuxt-svgo-sprite'],
  devtools: { enabled: false },
  svgSprite: {
    inputDir:'/assets/icons'
  }
})