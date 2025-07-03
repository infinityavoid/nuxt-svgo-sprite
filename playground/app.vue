<template>
  <div>
    <SvgSprite />
    <SvgUse symbol="complex" width="24" height="24" />
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.icon-container {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.icon-style {
  width: 50px;
  height: 50px;
  fill: black; /* Задайте цвет заливки по умолчанию */
}
</style>