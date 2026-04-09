<script setup lang="ts">
import { computed } from 'vue'
import type { CriterionStatus } from '../composables/useRun'

const props = defineProps<{ status: CriterionStatus }>()

const isSpinning = computed(() => props.status === 'in_progress')

const color = computed(() => {
  switch (props.status) {
    case 'pending':
      return 'var(--grey)'
    case 'in_progress':
      return 'var(--blue)'
    case 'clean':
      return 'var(--green)'
    case 'has_issues':
      return 'var(--amber)'
    case 'errored':
      return 'var(--red)'
  }
})
</script>

<template>
  <!-- In-progress: spinning ring. All others: solid dot. -->
  <span
    v-if="isSpinning"
    class="spinner"
    :style="{ borderColor: `${color}30`, borderTopColor: color }"
  />
  <span
    v-else
    class="dot"
    :style="{ background: color }"
  />
</template>

<style scoped>
.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid;
  flex-shrink: 0;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
