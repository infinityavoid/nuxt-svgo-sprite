import { defineNuxtPlugin } from '#app'
import SvgSprite from './components/SvgSprite.vue' // Import the new SvgSprite component

export default defineNuxtPlugin((nuxtApp) => {
    nuxtApp.vueApp.component('SvgSprite', SvgSprite) // Register the SvgSprite component globally

    // Optionally, you can expose some functions/values globally if needed
    // return {
    //   provide: {
    //     // You can expose some functions/values globally if needed
    //   },
    // }
})