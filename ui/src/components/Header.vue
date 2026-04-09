<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <header class="header">
    <RouterLink to="/" class="brand">
      <span class="desk">desk</span><span class="check">check</span>
    </RouterLink>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-subtle);
}
.brand {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.5px;
  text-decoration: none;
}
.desk {
  color: var(--accent);
}
.check {
  color: var(--text);
}
</style>
