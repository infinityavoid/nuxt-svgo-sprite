<template>
  <svg aria-hidden="true" focusable="false" :class="[className, 'svg-icon']" v-html="svgHtml" v-if="svgHtml" />
</template>

<script setup lang="ts">
import { useRuntimeConfig } from '#app';

const props = defineProps({
  icon: {
    type: String,
    required: true,
  },
  className: {
    type: String,
    default: '',
  },
});

const config = useRuntimeConfig();
const spriteName = config.public.svgoSprite?.spriteName || 'sprite';

const svgHtml = computed(() => {
  return `<use xlink:href="#${spriteName}-${props.icon}"></use>`;
});
</script>

<style scoped>
.svg-icon {
  width: 1em;
  height: 1em;
  fill: currentColor;
}
</style>