<template>
  <div>
    <h1>SVG Sprite Example</h1>

    <SvgSprite />

    <h2>Test Icons</h2>
    <div class="icon-container">
      <SvgIcon icon="test" class="icon-style" />
      <SvgIcon icon="complex" class="icon-style" />
      <SvgIcon icon="with-attributes" class="icon-style" />
      <SvgIcon icon="with-id" class="icon-style" />
      <SvgIcon icon="nested" class="icon-style" />
      <SvgIcon icon="no-viewbox" class="icon-style" />
    </div>
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