<script setup lang="ts">
import { computed } from 'vue'
import Badge from './Badge.vue'

const props = defineProps<{ status: string }>()

const palette = computed(() => {
  switch (props.status) {
    case 'complete':
      return {
        bg: 'var(--success-bg)',
        color: 'var(--success-text)',
        border: 'var(--success-border)',
      }
    case 'executing':
    case 'ready':
      return {
        bg: 'var(--info-bg)',
        color: 'var(--info-text)',
        border: 'var(--info-border)',
      }
    case 'failed':
      return {
        bg: 'var(--critical-bg)',
        color: 'var(--critical-text)',
        border: 'var(--critical-border)',
      }
    default:
      return {
        bg: 'var(--surface)',
        color: 'var(--text-muted)',
        border: 'var(--border)',
      }
  }
})
</script>

<template>
  <Badge :bg="palette.bg" :color="palette.color" :border="palette.border">
    {{ status }}
  </Badge>
</template>
