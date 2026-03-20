<script setup lang="ts">
import { computed } from 'vue'
import type { RunSummary } from '../types'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{
  run: RunSummary
}>()

const emit = defineEmits<{
  click: []
}>()

const sourceLabel = computed(() => {
  if (props.run.sourceType === 'diff') return `diff vs ${props.run.sourceTarget ?? '?'}`
  if (props.run.sourceType === 'file') return props.run.sourceTarget ?? ''
  if (props.run.sourceType === 'symbol') return `symbol: ${props.run.sourceTarget ?? ''}`
  return ''
})

const progressPct = computed(() => {
  if (!props.run.completion || props.run.completion.total === 0) return 0
  const done = props.run.completion.completed + (props.run.completion.errored ?? 0)
  return Math.round((done / props.run.completion.total) * 100)
})

const progressLabel = computed(() => {
  if (props.run.completion && props.run.completion.total > 0) {
    const done = props.run.completion.completed + (props.run.completion.errored ?? 0)
    return `${done}/${props.run.completion.total} tasks`
  }
  if (props.run.taskCount > 0) return `${props.run.taskCount} tasks`
  return ''
})

const hasProgress = computed(
  () => props.run.completion !== null && props.run.completion !== undefined && props.run.completion.total > 0,
)

const hasSummary = computed(
  () => props.run.summary !== null && props.run.summary !== undefined && props.run.summary.total > 0,
)

function timeAgo(isoStr: string | null): string {
  if (!isoStr) return ''
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
</script>

<template>
  <div class="run-card" @click="emit('click')">
    <div class="left">
      <div class="name">{{ run.name }}</div>
      <div class="meta">
        <span class="timestamp">{{ timeAgo(run.createdAt) }}</span>
        <span v-if="sourceLabel">{{ sourceLabel }}</span>
      </div>
      <div class="meta">
        <span v-if="run.moduleNames.length > 0">{{ run.moduleNames.join(', ') }}</span>
        <span v-if="run.matchedFiles > 0 || run.unmatchedFiles > 0">
          {{ run.matchedFiles }} files
          <template v-if="run.unmatchedFiles > 0">
            ({{ run.unmatchedFiles }} not covered)
          </template>
        </span>
      </div>
    </div>

    <div class="right">
      <StatusBadge :status="run.status" />
      <div v-if="progressLabel" class="meta" style="justify-content: flex-end">
        <span>{{ progressLabel }}</span>
        <span v-if="hasProgress" class="progress-bar">
          <span class="fill" :style="{ width: `${progressPct}%` }" />
        </span>
      </div>
      <span v-if="hasSummary" class="findings-inline">
        <span v-if="run.summary!.critical > 0" class="fc">{{ run.summary!.critical }}C</span>
        {{ ' ' }}
        <span v-if="run.summary!.warning > 0" class="fw">{{ run.summary!.warning }}W</span>
        {{ ' ' }}
        <span v-if="run.summary!.info > 0" class="fi">{{ run.summary!.info }}I</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.run-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
  align-items: center;
}

.run-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--accent);
}

.name {
  font-weight: 600;
  font-size: 0.95rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}

.right {
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
}

.timestamp {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.progress-bar {
  width: 80px;
  height: 4px;
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

.findings-inline {
  font-size: 0.8rem;
  font-weight: 600;
  font-family: var(--font-mono);
}

.fc {
  color: var(--color-critical);
}

.fw {
  color: var(--color-warning);
}

.fi {
  color: var(--color-info);
}
</style>
