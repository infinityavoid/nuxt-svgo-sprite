<template>
  <svg v-bind="$attrs">
    <use :href="`#${name}`" />
  </svg>
</template>

<script setup lang="ts">
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Nuxt resolves this alias in consumer app context.
import type { SvgIconName } from '#build/nuxt-svgo-sprite/icon-names'

defineOptions({ inheritAttrs: false })

export interface Props {
  name: SvgIconName
}

defineProps<Props>()
</script>
