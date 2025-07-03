<template>
  <component
      :is="sprite"
  />
</template>

<script lang="ts">
export default {
  props: {
    sprite: {
      type: Object,
      required: true,
    },
  },
}
</script>

<style>

</style>