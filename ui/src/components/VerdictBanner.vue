<script setup lang="ts">
import { inject, computed } from 'vue'
import { RUN_DATA_KEY } from '../composables/useRunData'

const data = inject(RUN_DATA_KEY)!

const verdictLabel = computed(() => {
  if (!data.results.value) return 'Waiting for review to start...'
  if (data.results.value.status !== 'complete') {
    const c = data.results.value.completion
    return `Review in progress \u2014 ${c.completed} of ${c.total} tasks done`
  }
  const s = data.results.value.summary
  switch (data.verdict.value) {
    case 'pass': return 'Ready to merge'
    case 'warn': return `${s.warning} ${s.warning === 1 ? 'warning' : 'warnings'} \u2014 review before merging`
    case 'fail': return `${s.critical} critical ${s.critical === 1 ? 'issue' : 'issues'} \u2014 do not merge`
    default: return ''
  }
})

const verdictClass = computed(() => {
  if (!data.results.value || data.results.value.status !== 'complete') return 'neutral'
  return data.verdict.value ?? 'neutral'
})

</script>

<template>
  <div class="verdict-banner" :class="verdictClass" role="status" aria-live="polite">
    <div class="verdict-inner">
      <span class="verdict-label">{{ verdictLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.verdict-banner { padding: 0.75rem 2rem; border-bottom: 1px solid var(--border); }
.verdict-inner { max-width: 1100px; margin: 0 auto; }
.verdict-label { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }

.verdict-banner.pass { background: rgba(102, 187, 106, 0.15); border-left: 4px solid var(--color-complete); }
.verdict-banner.pass .verdict-label { color: var(--color-complete); }
.verdict-banner.warn { background: rgba(255, 167, 38, 0.12); border-left: 4px solid var(--color-warning); }
.verdict-banner.warn .verdict-label { color: var(--color-warning); }
.verdict-banner.fail { background: rgba(239, 83, 80, 0.15); border-left: 4px solid var(--color-critical); }
.verdict-banner.fail .verdict-label { color: var(--color-critical); }
.verdict-banner.neutral { background: var(--bg-secondary); }
.verdict-banner.neutral .verdict-label { color: var(--text-muted); }
</style>
