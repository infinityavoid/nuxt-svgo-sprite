export default defineNuxtConfig({
  modules: ['nuxt-svgo-sprite'],
  devtools: { enabled: false },
  svgoSpriter: {
    inputDir:'/assets/icons',
    global: false,
    autoImportPath: './assets/icons/',
    spriteOutputPath: './assets/output/'
  }
})