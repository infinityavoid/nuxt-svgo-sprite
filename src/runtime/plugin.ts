import { defineNuxtPlugin } from '#app'
import { useSvgSprite } from './composables/useSvgSprite'

export default defineNuxtPlugin((nuxtApp) => {
  // Optionally, you can access and use options here
  const iconDir = nuxtApp.$config.public.svgSprite?.iconDir || 'assets/icons'
  useSvgSprite()

  return {
    provide: {
      // You can expose some functions/values globally if needed
    },
  }
})