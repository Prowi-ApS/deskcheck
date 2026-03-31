<script setup lang="ts">
import { inject, computed } from 'vue'
import { RUN_DATA_KEY } from '../composables/useRunData'

const data = inject(RUN_DATA_KEY)!

const verdictLabel = computed(() => {
  if (!data.results.value) return 'Waiting for review to start...'
  if (data.results.value.status !== 'complete') {
    const c = data.results.value.completion
    return `Review in progress (${c.completed}/${c.total} tasks)`
  }
  switch (data.verdict.value) {
    case 'pass': return 'Ready to merge'
    case 'warn': return 'Needs attention'
    case 'fail': return 'Action required'
    default: return ''
  }
})

const verdictClass = computed(() => {
  if (!data.results.value || data.results.value.status !== 'complete') return 'neutral'
  return data.verdict.value ?? 'neutral'
})

const summary = computed(() => data.results.value?.summary ?? null)
</script>

<template>
  <div class="verdict-banner" :class="verdictClass" role="status" aria-live="polite">
    <div class="verdict-inner">
      <span class="verdict-label">{{ verdictLabel }}</span>
      <span v-if="summary && summary.total > 0" class="verdict-counts">
        <span v-if="summary.critical > 0" class="count critical">{{ summary.critical }} critical</span>
        <span v-if="summary.warning > 0" class="count warning">{{ summary.warning }} warning</span>
        <span v-if="summary.info > 0" class="count info">{{ summary.info }} info</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.verdict-banner { padding: 0.75rem 2rem; border-bottom: 1px solid var(--border); }
.verdict-inner { max-width: 1100px; margin: 0 auto; display: flex; align-items: center; gap: 1rem; }
.verdict-label { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.verdict-counts { display: flex; gap: 0.75rem; font-size: 0.75rem; font-weight: 600; }
.count.critical { color: var(--color-critical); }
.count.warning { color: var(--color-warning); }
.count.info { color: var(--color-info); }

.verdict-banner.pass { background: rgba(102, 187, 106, 0.15); border-left: 4px solid var(--color-complete); }
.verdict-banner.pass .verdict-label { color: var(--color-complete); }
.verdict-banner.warn { background: rgba(255, 167, 38, 0.12); border-left: 4px solid var(--color-warning); }
.verdict-banner.warn .verdict-label { color: var(--color-warning); }
.verdict-banner.fail { background: rgba(239, 83, 80, 0.15); border-left: 4px solid var(--color-critical); }
.verdict-banner.fail .verdict-label { color: var(--color-critical); }
.verdict-banner.neutral { background: var(--bg-secondary); }
.verdict-banner.neutral .verdict-label { color: var(--text-muted); }
</style>
