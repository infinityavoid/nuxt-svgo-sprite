<template>
  <svg
      :width="size"
      :height="size"
      class="icon"
      :class="customClass"
      aria-hidden="true"
  >
    <use :href="`#icon-${name}`" />
  </svg>
</template>

<script setup>
defineProps({
  name: {
    type: String,
    required: true,
  },
  size: {
    type: String,
    default: '24px',
  },
  customClass: {
    type: String,
    default: '',
  },
})
</script>

<style scoped>
.icon {
  fill: currentColor;
}
</style>