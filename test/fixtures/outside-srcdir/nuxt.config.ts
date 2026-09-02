import NuxtSvgoSprite from '../../../src/module'

export default defineNuxtConfig({
  modules: [NuxtSvgoSprite],
  srcDir: './app',
  svgoSprite: {
    // Resolves OUTSIDE srcDir (rootDir/icons vs. rootDir/app) — without pushing
    // this onto nuxt.options.watch, Nuxt's dev watcher never covers it (it only
    // watches each layer's own srcDir tree by default).
    inputDir: '~~/icons',
  },
})
