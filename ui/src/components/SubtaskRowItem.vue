<script setup lang="ts">
import { computed } from 'vue'
import type { SubtaskRow } from '../composables/useRun'
import StatusDot from './StatusDot.vue'
import { formatDuration, formatTokens } from '../utils/format'

const props = defineProps<{
  subtask: SubtaskRow
  /** Whether this row is rendered nested under a criterion (extra left indent). */
  nested?: boolean
}>()

defineEmits<{
  (e: 'navigate', taskId: string): void
}>()

/** "first-file +N more" naming for multi-file subtasks. */
const name = computed(() => {
  const first = props.subtask.files[0] ?? '(no files)'
  const filename = first.split('/').pop() ?? first
  if (props.subtask.files.length > 1) {
    return `${filename} +${props.subtask.files.length - 1} more`
  }
  return filename
})

const focusSuffix = computed(() => props.subtask.focus)

const meta = computed(() => {
  const sub = props.subtask
  if (sub.taskStatus === 'pending') return 'pending'
  if (sub.taskStatus === 'in_progress') return 'running...'
  if (sub.taskStatus === 'error') return `error${sub.error ? `: ${truncate(sub.error, 60)}` : ''}`
  // complete
  const parts: string[] = []
  if (sub.issueCount > 0) {
    const word = sub.issueCount === 1 ? 'issue' : 'issues'
    parts.push(`${sub.issueCount} ${word}`)
  }
  if (sub.inputTokens > 0) parts.push(`${formatTokens(sub.inputTokens)} tokens`)
  if (sub.durationMs > 0) parts.push(formatDuration(sub.durationMs))
  return parts.join(' · ')
})

const metaClass = computed(() => {
  if (props.subtask.taskStatus === 'error') return 'error'
  if (props.subtask.issueCount > 0) return 'has-issues'
  return ''
})

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
</script>

<template>
  <div class="row" :class="{ nested }" @click="$emit('navigate', subtask.task_id)">
    <StatusDot :status="subtask.status" />
    <span class="name">
      {{ name }}<span v-if="focusSuffix" class="focus"> → {{ focusSuffix }}</span>
    </span>
    <span class="meta" :class="metaClass">
      <span v-if="subtask.taskStatus === 'in_progress'" class="inline-spinner" />
      {{ meta }}
    </span>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background 0.1s;
}
.row.nested {
  padding-left: 32px;
}
.row:last-child {
  border-bottom: none;
}
.row:hover {
  background: var(--surface-hover);
}
.name {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus {
  color: var(--text-muted);
}
.meta {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}
.meta.has-issues {
  color: var(--amber);
}
.meta.error {
  color: var(--red);
}
.inline-spinner {
  display: inline-block;
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--blue);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: 4px;
  vertical-align: middle;
  position: relative;
  top: -0.5px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
