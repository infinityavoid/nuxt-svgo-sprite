<template>
  <svg :class="svgClass" :width="width" :height="height" :aria-hidden="ariaHidden">
    <use :xlink:href="symbolId" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

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
  width?: string | number;
  /**
   * Height of the svg.
   */
  height?: string | number;
  /**
   * Hides the svg from assistive technologies.
   */
  ariaHidden?: boolean;
}

const props = defineProps<Props>();

const symbolId = computed(() => `#${props.symbol}`);
</script>