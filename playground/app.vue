<template>
  <div>
    <SvgSprite/>
    <SvgUse symbol="complex" width="24" height="24" svgClass="my-icon-class" />
    <SvgUse symbol="nested" width="32" height="32" />
    <SvgUse symbol="no-viewbox" width="32" height="32" />
    <SvgUse symbol="test" width="32" height="32" />
    <SvgUse symbol="with-attributes" width="32" height="32" />
    <SvgUse symbol="with-id" width="32" height="32" />
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