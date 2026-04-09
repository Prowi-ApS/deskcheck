<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

export interface CrumbItem {
  label: string
  to?: RouteLocationRaw
}

defineProps<{ items: CrumbItem[] }>()
</script>

<template>
  <nav class="crumb">
    <template v-for="(item, i) in items" :key="i">
      <span v-if="i > 0" class="sep">→</span>
      <router-link v-if="item.to && i < items.length - 1" :to="item.to" class="link">
        {{ item.label }}
      </router-link>
      <span v-else class="current">{{ item.label }}</span>
    </template>
  </nav>
</template>

<style scoped>
.crumb {
  font-size: 13px;
  margin-bottom: 16px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.sep {
  color: var(--text-dim);
}
.link {
  color: var(--accent);
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
.current {
  color: var(--text);
  font-weight: 600;
}
</style>
