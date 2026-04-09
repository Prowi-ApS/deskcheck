<script setup lang="ts">
import type { PipelineState, PipelineCellState } from '../composables/useRun'

defineProps<{ state: PipelineState }>()

const STEPS: { key: keyof PipelineState; label: string }[] = [
  { key: 'matching', label: 'Matching' },
  { key: 'partitioning', label: 'Partitioning' },
  { key: 'reviewing', label: 'Reviewing' },
  { key: 'complete', label: 'Complete' },
]

function classFor(s: PipelineCellState): string {
  return `cell-${s}`
}
</script>

<template>
  <div class="pipeline">
    <template v-for="(step, i) in STEPS" :key="step.key">
      <div class="cell" :class="classFor(state[step.key])">
        <span v-if="state[step.key] === 'done'">✓ </span>
        <span v-else-if="state[step.key] === 'active'" class="cell-spinner" />
        {{ step.label }}
      </div>
      <div v-if="i < STEPS.length - 1" class="sep" />
    </template>
  </div>
</template>

<style scoped>
.pipeline {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 20px;
}
.cell {
  flex: 1;
  text-align: center;
  padding: 7px 0;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  border: 1px solid;
}
.cell-done {
  background: var(--success-bg);
  border-color: var(--success-border);
  color: var(--green);
}
.cell-active {
  background: var(--info-bg);
  border-color: var(--info-border);
  color: var(--blue);
}
.cell-pending {
  background: var(--surface);
  border-color: var(--border-subtle);
  color: var(--text-dim);
}
.cell-failed {
  background: var(--critical-bg);
  border-color: var(--critical-border);
  color: var(--red);
}
.sep {
  width: 16px;
  height: 1px;
  background: var(--border);
  flex-shrink: 0;
}
.cell-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid var(--blue);
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
