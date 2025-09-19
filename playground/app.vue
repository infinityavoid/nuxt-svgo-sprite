<template>
  <div>
    <SvgSprite />
    <div v-for="i in 20" style="display:flex;">
      <div v-for="i in 20">
        <SvgUse symbol="complex" width="24" height="24"/>
        <SvgUse symbol="nested" width="32" height="32" />
        <SvgUse symbol="no-viewbox" width="32" height="32" />
        <SvgUse symbol="test" width="32" height="32" />
        <SvgUse symbol="with-attributes" width="32" height="32" />
        <SvgUse symbol="with-id" width="32" height="32" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
</script>