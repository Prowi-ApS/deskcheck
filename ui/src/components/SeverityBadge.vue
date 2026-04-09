<script setup lang="ts">
import { computed } from 'vue'
import Badge from './Badge.vue'
import type { FindingSeverity } from '../types'

const props = defineProps<{ severity: FindingSeverity }>()

const palette = computed(() => {
  if (props.severity === 'critical') {
    return {
      bg: 'var(--critical-bg)',
      color: 'var(--critical-text)',
      border: 'var(--critical-border)',
    }
  }
  if (props.severity === 'warning') {
    return {
      bg: 'var(--warning-bg)',
      color: 'var(--warning-text)',
      border: 'var(--warning-border)',
    }
  }
  return {
    bg: 'var(--info-bg)',
    color: 'var(--info-text)',
    border: 'var(--info-border)',
  }
})
</script>

<template>
  <Badge :bg="palette.bg" :color="palette.color" :border="palette.border">
    {{ severity }}
  </Badge>
</template>
