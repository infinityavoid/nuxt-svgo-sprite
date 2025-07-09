<template>
  <svg :class="svgClass" :width="width" :height="height" :aria-hidden="ariaHidden">
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
  /**
   * Style to apply to the svg.
   */
  svgStyle?: object;
  /**
   * Width of the svg.
   */
  width?: string | number;
  /**
   * Height of the svg.
   */
  height?: string | number;

  ariaHidden?: boolean
}
defineProps<Props>()
</script>