<script setup lang="ts">
import { inject } from 'vue'
import { RUN_DATA_KEY } from '../composables/useRunData'
import { formatDuration, formatCost, sortIndicator } from '../utils/format'

const data = inject(RUN_DATA_KEY)!

const emit = defineEmits<{
  'navigate-to-file': [filePath: string]
}>()
</script>

<template>
  <div class="tasks-tab">
    <!-- Summary bar -->
    <div v-if="data.results.value" class="summary-bar">
      <div class="summary-item">
        <span class="summary-value">{{ data.results.value.completion.completed }}/{{ data.results.value.completion.total }}</span>
        <span class="summary-label">Tasks completed</span>
      </div>
      <div v-if="data.results.value.completion.errored > 0" class="summary-item error">
        <span class="summary-value">{{ data.results.value.completion.errored }}</span>
        <span class="summary-label">Failed</span>
      </div>
      <div v-if="data.usage.value" class="summary-item">
        <span class="summary-value">{{ formatCost(data.usage.value.cost_usd) }}</span>
        <span class="summary-label">Total cost</span>
      </div>
      <div v-if="data.runDuration.value" class="summary-item">
        <span class="summary-value">{{ data.runDuration.value }}</span>
        <span class="summary-label">Wall time</span>
      </div>
      <div v-if="data.usage.value" class="summary-item">
        <span class="summary-value">{{ (data.usage.value.input_tokens + data.usage.value.output_tokens).toLocaleString() }}</span>
        <span class="summary-label">Tokens used</span>
      </div>
    </div>

    <!-- Progress -->
    <div v-if="data.results.value && data.completionPct.value < 100" class="progress-section">
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: data.completionPct.value + '%' }" />
      </div>
    </div>

    <!-- Task table -->
    <table class="task-table">
      <thead>
        <tr>
          <th class="sortable" @click="data.toggleTaskSort('task_id')">File{{ sortIndicator(data.taskSortKey.value === 'task_id', data.taskSortAsc.value) }}</th>
          <th class="sortable" @click="data.toggleTaskSort('criterion')">Criterion{{ sortIndicator(data.taskSortKey.value === 'criterion', data.taskSortAsc.value) }}</th>
          <th>Status</th>
          <th class="sortable num" @click="data.toggleTaskSort('duration')">Duration{{ sortIndicator(data.taskSortKey.value === 'duration', data.taskSortAsc.value) }}</th>
          <th class="sortable num" @click="data.toggleTaskSort('cost')">Cost{{ sortIndicator(data.taskSortKey.value === 'cost', data.taskSortAsc.value) }}</th>
          <th class="sortable num" @click="data.toggleTaskSort('findings')">Issues{{ sortIndicator(data.taskSortKey.value === 'findings', data.taskSortAsc.value) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in data.taskRows.value"
          :key="row.task_id"
          :class="['task-row', `status-${row.status}`, { clickable: row.status === 'complete' && row.totalFindings > 0 }]"
          @click="row.status === 'complete' && row.totalFindings > 0 ? emit('navigate-to-file', row.files[0]!) : undefined"
        >
          <td class="file-cell">
            <span class="task-filename">{{ row.files[0]?.split('/').pop() }}<template v-if="row.files.length > 1"> <span class="extra-files">+{{ row.files.length - 1 }} more</span></template></span>
            <span class="task-filepath">{{ row.files[0]?.split('/').slice(0, -1).join('/') }}</span>
          </td>
          <td>
            <span class="criterion-badge">{{ row.criterionLabel }}</span>
            <span class="model-badge">{{ row.model }}</span>
          </td>
          <td>
            <span class="task-status-badge" :class="row.status">{{ row.status === 'in_progress' ? 'running' : row.status }}</span>
          </td>
          <td class="num">
            <template v-if="row.status === 'complete' || row.status === 'error'">{{ formatDuration(row.duration_ms) }}</template>
            <span v-else class="dim">&mdash;</span>
          </td>
          <td class="num">
            <template v-if="row.status === 'complete' || row.status === 'error'">{{ formatCost(row.cost_usd) }}</template>
            <span v-else class="dim">&mdash;</span>
          </td>
          <td class="num issues-cell">
            <template v-if="row.status === 'complete'">
              <span v-if="row.critical" class="sev-count critical">{{ row.critical }}</span>
              <span v-if="row.warning" class="sev-count warning">{{ row.warning }}</span>
              <span v-if="row.info" class="sev-count info">{{ row.info }}</span>
              <span v-if="row.totalFindings === 0" class="clean-badge">0</span>
            </template>
            <span v-else class="dim">&mdash;</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tasks-tab { max-width: 1100px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }

.summary-bar { display: flex; gap: 1.5rem; margin-bottom: 1.25rem; padding: 0.75rem 1rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; }
.summary-item { display: flex; flex-direction: column; align-items: center; }
.summary-value { font-family: var(--font-mono); font-size: 0.9rem; font-weight: 600; }
.summary-label { font-size: 0.6875rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 0.1rem; }
.summary-item.error .summary-value { color: var(--color-critical); }

.progress-section { margin-bottom: 1rem; }
.progress-track { height: 6px; background: var(--bg-card); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--color-complete); border-radius: 3px; transition: width 0.3s ease; }

.task-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.task-table thead th { padding: 0.4rem 0.75rem; text-align: left; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); background: var(--bg-expand); border-bottom: 1px solid var(--border); }
.task-table tbody td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
.task-table tbody tr:last-child td { border-bottom: none; }
.task-table .num { text-align: right; font-family: var(--font-mono); font-size: 0.75rem; }
.task-table .sortable { cursor: pointer; user-select: none; }
.task-table .sortable:hover { color: var(--accent); }

.task-row { transition: background 0.1s ease; }
.task-row:hover { background: var(--bg-card-hover); }
.task-row.clickable { cursor: pointer; }
.task-row.clickable:hover { background: rgba(79, 195, 247, 0.08); }
.task-row.status-pending { opacity: 0.5; }
.task-row.status-in_progress { background: rgba(171, 71, 188, 0.06); }
.task-row.status-error { background: rgba(239, 83, 80, 0.04); }

.file-cell { display: flex; flex-direction: column; gap: 0.1rem; }
.task-filename { font-family: var(--font-mono); font-weight: 500; font-size: 0.8rem; }
.extra-files { font-size: 0.6875rem; color: var(--text-muted); font-weight: 400; }
.task-filepath { font-size: 0.6875rem; color: var(--text-muted); }
.criterion-badge { font-size: 0.75rem; font-weight: 500; }
.model-badge { font-size: 0.6875rem; color: var(--text-muted); background: var(--bg-expand); padding: 0.1rem 0.4rem; border-radius: 3px; font-family: var(--font-mono); margin-left: 0.4rem; }

.task-status-badge { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; padding: 0.15rem 0.4rem; border-radius: 3px; }
.task-status-badge.complete { background: rgba(102, 187, 106, 0.15); color: var(--color-complete); }
.task-status-badge.in_progress { background: rgba(171, 71, 188, 0.2); color: var(--color-running); animation: pulse 2s ease-in-out infinite; }
.task-status-badge.pending { background: rgba(90, 100, 120, 0.2); color: var(--text-muted); }
.task-status-badge.error { background: rgba(239, 83, 80, 0.15); color: var(--color-critical); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

.issues-cell { display: flex; gap: 0.25rem; justify-content: flex-end; align-items: center; }
.sev-count { font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; padding: 0.1rem 0.35rem; border-radius: 3px; }
.sev-count.critical { background: rgba(239, 83, 80, 0.2); color: var(--color-critical); }
.sev-count.warning { background: rgba(255, 167, 38, 0.15); color: var(--color-warning); }
.sev-count.info { background: rgba(79, 195, 247, 0.1); color: var(--color-info); }
.clean-badge { font-size: 0.7rem; color: var(--text-muted); }
.dim { color: var(--text-muted); }
</style>
