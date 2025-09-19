export default defineNuxtConfig({
  ssr: true,
  devtools: { enabled: false },
  modules: ["nuxt-svgo"],
  svgo: {
    global: false,
    autoImportPath: "./assets/icons",
    componentPrefix: "Icon",
  }
})