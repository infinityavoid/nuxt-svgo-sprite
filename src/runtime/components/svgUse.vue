<template>
  <svg :class="svgClass">
    <use :href="`#${symbol}`" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  /** The id of the symbol to use from the sprite. */
  symbol: string
  /** CSS class(es) to apply to the svg element. */
  svgClass?: string | string[]
}>()
</script>
