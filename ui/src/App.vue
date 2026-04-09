<script setup lang="ts">
import Header from './components/Header.vue'
</script>

<template>
  <div class="container">
    <Header />
    <router-view />
  </div>
</template>

<style scoped>
.container {
  max-width: 1060px;
  margin: 0 auto;
  padding: 20px 28px;
  min-height: 100vh;
}
</style>
