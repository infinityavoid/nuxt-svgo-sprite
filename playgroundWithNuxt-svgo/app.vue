<template>
  <div v-for="i in 20" style="display: flex">
    <div v-for="i in 20">
      <IconComplex filled/>
      <IconNested filled/>
      <IconNoViewbox filled/>
      <IconTest filled/>
      <IconWithAttributes  filled/>
      <IconWithId filled/>
    </div>
  </div>
</template>
<script setup lang="ts">
</script>