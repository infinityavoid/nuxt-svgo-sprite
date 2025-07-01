import { defineNuxtPlugin } from '#app';
import { useRuntimeConfig } from '#app';
import SvgIcon from './components/SvgIcon.vue'; // Импортируем компонент

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();
  const spriteName = config.public.svgoSprite?.spriteName || 'sprite';

  // Регистрируем компонент глобально
  nuxtApp.vueApp.component('SvgIcon', SvgIcon);

  return {
    provide: {
      spriteName: spriteName,
    },
  };
});