import { ModuleOptions } from '../types'

declare module '@nuxt/schema' {
  interface NuxtConfig {
    svgSprite?: Partial<ModuleOptions>
  }
  interface NuxtOptions {
    svgSprite?: ModuleOptions
  }
}
export { }