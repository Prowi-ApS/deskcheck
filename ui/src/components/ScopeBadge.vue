<script setup lang="ts">
import Badge from './Badge.vue'
import type { Scope } from '../types'

defineProps<{ scope: Scope | null }>()
</script>

<template>
  <span v-if="!scope" class="dim">—</span>
  <Badge
    v-else-if="scope.type === 'all'"
    bg="var(--info-bg)"
    color="var(--info-text)"
    border="var(--info-border)"
  >
    all files
  </Badge>
  <span v-else class="changes">changes → {{ scope.ref }}</span>
</template>

<style scoped>
.changes {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--teal);
}
.dim {
  color: var(--text-dim);
  font-size: 11px;
}
</style>
