<template>
  <svg>
    <use :href="'#sprite-' + icon" />
  </svg>
</template>

<script setup>
defineProps({
  icon: {
    type: String,
    required: true,
  },
});
</script>