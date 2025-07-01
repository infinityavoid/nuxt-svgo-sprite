<template>
  <div v-html="spriteContent" aria-hidden="true" style="position: absolute; width: 0; height: 0; overflow: hidden;"></div>
</template>

<script setup>
const spriteContent = `
      <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position: absolute; width: 0; height: 0; overflow: hidden;">
            ${getSpriteContent()}
      </svg>
    `
function getSpriteContent() {
  try {
    if (process.client) {
      // Только на клиенте:
      return fetch('/sprites/icons.svg').then(res => res.text())
    }
    return ""
  } catch (e) {
    return ''
  }
}
</script>