<template>
  <svg :class="svgClass">
    <use :href="'#' + symbol" />
  </svg>
</template>

<script setup lang="ts">
export interface Props {
  /**
   * The id of the symbol to use from the sprite.
   */
  symbol: string;
  /**
   * Css class(es) to apply to the svg.
   */
  svgClass?: string | string[];
}
defineProps<Props>()
</script>