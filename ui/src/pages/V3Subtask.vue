<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRun, useElapsed } from '../composables/useRun'
import { useRunSse } from '../composables/useRunSse'
import type { FindingSeverity } from '../types'
import Crumb from '../components/Crumb.vue'
import Meta from '../components/Meta.vue'
import Stat from '../components/Stat.vue'
import TokenCard from '../components/TokenCard.vue'
import SeverityBadge from '../components/SeverityBadge.vue'
import FilterChips, { type ChipOption } from '../components/FilterChips.vue'
import { formatDuration, formatTokens, formatCost } from '../utils/format'

const props = defineProps<{ planId: string; taskId: string }>()
const run = useRun(props.planId)
useRunSse(props.planId, run)

const sub = computed(() => run.subtaskRow(props.taskId))
const issues = computed(() => run.issuesForTask(props.taskId))

// -- Live elapsed --
const startedAt = computed(() => sub.value?.task.started_at ?? null)
const completedAt = computed(() => sub.value?.task.completed_at ?? null)
const elapsedMs = useElapsed(startedAt, completedAt)

const elapsedDisplay = computed(() => (elapsedMs.value > 0 ? formatDuration(elapsedMs.value) : '—'))

const usage = computed(() => {
  const r = run.results.value?.task_results[props.taskId]
  return r?.usage ?? null
})

const subtaskTokens = computed(() => sub.value?.tokens ?? {
  uncached: 0, cacheCreate: 0, cacheRead: 0, totalInput: 0, output: 0, cost: 0,
})

const turnsLabel = computed(() => {
  const u = usage.value
  if (!u) return ''
  return `${u.num_turns} turn${u.num_turns === 1 ? '' : 's'}`
})

const issueBreakdown = computed(() => {
  const c = issues.value.filter((i) => i.severity === 'critical').length
  const w = issues.value.filter((i) => i.severity === 'warning').length
  const n = issues.value.filter((i) => i.severity === 'info').length
  return `${c} critical · ${w} warning · ${n} info`
})

// -- Status display with color --
const statusColor = computed(() => {
  if (!sub.value) return 'var(--text-muted)'
  switch (sub.value.taskStatus) {
    case 'complete':
      return 'var(--green)'
    case 'in_progress':
      return 'var(--blue)'
    case 'error':
      return 'var(--red)'
    default:
      return 'var(--text-muted)'
  }
})

// -- Filter --
const severityFilter = ref<FindingSeverity | 'all'>('all')

const severityOptions: ChipOption<FindingSeverity | 'all'>[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical', activeBg: 'var(--critical-bg)', activeColor: 'var(--critical-text)' },
  { value: 'warning', label: 'Warning', activeBg: 'var(--warning-bg)', activeColor: 'var(--warning-text)' },
  { value: 'info', label: 'Info', activeBg: 'var(--info-bg)', activeColor: 'var(--info-text)' },
]

const filteredIssues = computed(() => {
  if (severityFilter.value === 'all') return issues.value
  return issues.value.filter((i) => i.severity === severityFilter.value)
})

/**
 * Split a reference's `code` snippet into context-before, flagged lines, and
 * context-after using startLine/endLine/contextLines. The code blob starts at
 * `startLine - contextLines` so we can slice it deterministically.
 */
function snippetParts(ref: { code: string | null; startLine: number; endLine: number; contextLines: number }) {
  if (!ref.code) return { before: '', flagged: '', after: '' }
  const lines = ref.code.split('\n')
  const ctx = ref.contextLines
  const totalFlagged = ref.endLine - ref.startLine + 1
  // Context lines before the flagged range (clamped — startLine might be near top of file)
  const actualBefore = Math.min(ctx, ref.startLine - 1)
  const beforeLines = lines.slice(0, actualBefore)
  const flaggedLines = lines.slice(actualBefore, actualBefore + totalFlagged)
  const afterLines = lines.slice(actualBefore + totalFlagged)
  return {
    before: beforeLines.join('\n'),
    flagged: flaggedLines.join('\n'),
    after: afterLines.join('\n'),
  }
}

const reviewId = computed(() => sub.value?.review_id ?? null)

const breadcrumbItems = computed(() => {
  const items: { label: string; to?: any }[] = [
    { label: 'Reviews', to: { name: 'runs' } },
    { label: props.planId, to: { name: 'run', params: { planId: props.planId } } },
  ]
  if (reviewId.value) {
    items.push({
      label: reviewId.value,
      to: {
        name: 'criterion',
        params: { planId: props.planId, criterionId: reviewId.value },
      },
    })
  }
  items.push({ label: props.taskId })
  return items
})
</script>

<template>
  <div>
    <Crumb :items="breadcrumbItems" />

    <div v-if="!run.plan.value" class="empty">Loading…</div>
    <div v-else-if="!sub" class="empty">
      Subtask <strong>{{ taskId }}</strong> not found in this run.
    </div>
    <template v-else>
      <Meta
        :items="[
          { label: 'Model', value: sub.task.model, mono: true },
          { label: 'Focus', value: sub.focus ?? 'entire file' },
          { label: 'Status' },
          { label: 'Criterion' },
        ]"
      >
        <template #Status>
          <span :style="{ color: statusColor, fontWeight: 600 }">{{ sub.taskStatus }}</span>
        </template>
        <template #Criterion>
          <router-link
            v-if="reviewId"
            :to="{ name: 'criterion', params: { planId, criterionId: reviewId } }"
            class="link"
          >
            {{ reviewId }}
          </router-link>
        </template>
      </Meta>

      <div v-if="sub.error" class="error-block">
        <div class="label">Error</div>
        <div class="text">{{ sub.error }}</div>
      </div>

      <div class="files-section">
        <div class="files-label">Assigned files</div>
        <div class="files">
          <div v-for="f in sub.files" :key="f" class="file">
            {{ f }}
            <span v-if="sub.focus" class="focus">({{ sub.focus }})</span>
          </div>
        </div>
      </div>

      <div class="stats">
        <Stat label="Elapsed" :value="elapsedDisplay" :sub="turnsLabel" />
        <TokenCard label="Tokens" :bucket="subtaskTokens" />
        <Stat
          label="Issues"
          :value="issues.length"
          :sub="issues.length > 0 ? issueBreakdown : 'clean'"
        />
      </div>

      <h3 class="section-title">Issues ({{ issues.length }})</h3>
      <FilterChips v-if="issues.length > 0" v-model="severityFilter" :options="severityOptions" />

      <div v-if="filteredIssues.length === 0" class="empty">
        <template v-if="sub.taskStatus === 'error'">
          This subtask errored before producing results.
        </template>
        <template v-else-if="sub.taskStatus === 'complete'">No issues found.</template>
        <template v-else>No issues found yet.</template>
      </div>

      <div class="issue-list">
        <div v-for="issue in filteredIssues" :key="issue.issue_id" class="issue-card">
          <div class="card-head"><SeverityBadge :severity="issue.severity" /></div>
          <div class="description">{{ issue.description }}</div>
          <div v-if="issue.suggestion" class="suggestion">
            <span class="suggestion-label">Suggestion:</span> {{ issue.suggestion }}
          </div>
          <div class="references">
            <div v-for="(ref, i) in issue.references" :key="i" class="reference">
              <div class="ref-path">
                {{ ref.file.split('/').pop() }}<span v-if="ref.startLine">:{{ ref.startLine === ref.endLine ? ref.startLine : `${ref.startLine}-${ref.endLine}` }}</span>
              </div>
              <div v-if="ref.code" class="code-block">
                <template v-if="ref.suggestedCode">
                  <div v-if="snippetParts(ref).before" class="code ctx">{{ snippetParts(ref).before }}</div>
                  <div class="code old">− {{ snippetParts(ref).flagged }}</div>
                  <div class="code new">+ {{ ref.suggestedCode }}</div>
                  <div v-if="snippetParts(ref).after" class="code ctx">{{ snippetParts(ref).after }}</div>
                </template>
                <template v-else>
                  <div v-if="snippetParts(ref).before" class="code ctx">{{ snippetParts(ref).before }}</div>
                  <div class="code old">{{ snippetParts(ref).flagged }}</div>
                  <div v-if="snippetParts(ref).after" class="code ctx">{{ snippetParts(ref).after }}</div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.empty {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 20px 14px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}
.error-block {
  background: var(--critical-bg);
  border: 1px solid var(--critical-border);
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 16px;
}
.error-block .label {
  font-size: 9px;
  color: var(--critical-text);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
  font-weight: 600;
}
.error-block .text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--critical-text);
  white-space: pre-wrap;
  word-break: break-word;
}
.files-section {
  margin-bottom: 16px;
}
.files-label {
  font-size: 9px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 6px;
}
.files {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 10px;
}
.file {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text);
  line-height: 1.8;
}
.focus {
  color: var(--text-muted);
  margin-left: 8px;
}
.stats {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.section-title {
  font-size: 13px;
  margin-bottom: 10px;
}
.link {
  color: var(--accent);
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
.issue-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}
.issue-card {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 14px;
}
.card-head {
  margin-bottom: 8px;
}
.description {
  font-size: 12px;
  color: var(--text);
  line-height: 1.6;
  margin-bottom: 8px;
}
.suggestion {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  margin-bottom: 8px;
}
.suggestion-label {
  font-weight: 600;
  color: var(--text-dim);
}
.references {
  border-top: 1px solid var(--border-subtle);
  padding-top: 8px;
}
.reference {
  margin-bottom: 8px;
}
.reference:last-child {
  margin-bottom: 0;
}
.ref-path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--teal);
  margin-bottom: 4px;
}
.code-block {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.code {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 3px;
  border: 1px solid;
  white-space: pre-wrap;
  word-break: break-word;
}
.code.ctx {
  background: var(--bg);
  border-color: var(--border);
  color: var(--text);
}
.code.old {
  background: var(--critical-bg);
  border-color: var(--critical-border);
  color: var(--critical-text);
}
.code.new {
  background: var(--success-bg);
  border-color: var(--success-border);
  color: var(--success-text);
}
</style>
