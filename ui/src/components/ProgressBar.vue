<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  completed: number
  total: number
}>()

const percentage = computed(() => {
  if (props.total === 0) return 0
  return Math.round((props.completed / props.total) * 100)
})
</script>

<template>
  <div class="progress-wrapper">
    <span class="progress-bar">
      <span class="fill" :style="{ width: `${percentage}%` }" />
    </span>
    <span class="label">{{ completed }}/{{ total }} tasks</span>
  </div>
</template>

<style scoped>
.progress-wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}

.progress-bar {
  flex: 1;
  min-width: 120px;
  height: 6px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
  display: inline-block;
  vertical-align: middle;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--color-complete);
  transition: width 0.3s ease;
}

.label {
  font-size: 0.85rem;
  color: var(--text-secondary);
}
</style>
