<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useRun, useElapsed } from '../composables/useRun'
import { useRunSse } from '../composables/useRunSse'
import type { FindingSeverity } from '../types'
import Crumb from '../components/Crumb.vue'
import Meta from '../components/Meta.vue'
import Stat from '../components/Stat.vue'
import TokenCard from '../components/TokenCard.vue'
import Collapse from '../components/Collapse.vue'
import FilterChips, { type ChipOption } from '../components/FilterChips.vue'
import IssuesTable from '../components/IssuesTable.vue'
import SubtaskRowItem from '../components/SubtaskRowItem.vue'
import { formatDuration, formatTokens, formatCost } from '../utils/format'

const props = defineProps<{ planId: string; criterionId: string }>()
const router = useRouter()

const run = useRun(props.planId)
useRunSse(props.planId, run)

const row = computed(() => run.criterionRow(props.criterionId))

// -- Live elapsed: earliest subtask start until last completion (or now if any pending) --
const earliestStart = computed<string | null>(() => {
  const r = row.value
  if (!r) return null
  const starts = r.subtasks.map((s) => s.task.started_at).filter((x): x is string => x !== null)
  if (starts.length === 0) return null
  return starts.reduce((a, b) => (a < b ? a : b))
})

const latestEnd = computed<string | null>(() => {
  const r = row.value
  if (!r) return null
  // If any subtask is still running, end = now (live tick).
  const anyRunning = r.subtasks.some(
    (s) => s.taskStatus === 'pending' || s.taskStatus === 'in_progress',
  )
  if (anyRunning) return null
  const ends = r.subtasks.map((s) => s.task.completed_at).filter((x): x is string => x !== null)
  if (ends.length === 0) return null
  return ends.reduce((a, b) => (a > b ? a : b))
})

const elapsedMs = useElapsed(earliestStart, latestEnd)

const elapsedDisplay = computed(() => (elapsedMs.value > 0 ? formatDuration(elapsedMs.value) : '—'))

// -- Stats --

const decision = computed(() => row.value?.decision ?? null)
const matchedFiles = computed(() => decision.value?.matched_files ?? [])

import type { TokenBucket } from '../composables/useRun'

const partitionerTokens = computed<TokenBucket>(() => {
  const u = decision.value?.usage
  if (!u) return { uncached: 0, cacheCreate: 0, cacheRead: 0, totalInput: 0, output: 0, cost: 0 }
  return {
    uncached: u.input_tokens,
    cacheCreate: u.cache_creation_tokens,
    cacheRead: u.cache_read_tokens,
    totalInput: u.input_tokens + u.cache_creation_tokens + u.cache_read_tokens,
    output: u.output_tokens,
    cost: u.cost_usd,
  }
})

const reviewerTokens = computed<TokenBucket>(() => {
  const r = row.value
  if (!r) return { uncached: 0, cacheCreate: 0, cacheRead: 0, totalInput: 0, output: 0, cost: 0 }
  // Subtract the partitioner from the criterion total to get reviewers-only
  const pt = partitionerTokens.value
  return {
    uncached: r.tokens.uncached - pt.uncached,
    cacheCreate: r.tokens.cacheCreate - pt.cacheCreate,
    cacheRead: r.tokens.cacheRead - pt.cacheRead,
    totalInput: r.tokens.totalInput - pt.totalInput,
    output: r.tokens.output - pt.output,
    cost: r.tokens.cost - pt.cost,
  }
})

const completedReviewerCount = computed(() => {
  const r = row.value
  if (!r) return 0
  return r.subtasks.filter((s) => s.taskStatus === 'complete' || s.taskStatus === 'error').length
})

const issuesForCriterion = computed(() => run.issuesForCriterion(props.criterionId))

const issueBreakdown = computed(() => {
  const issues = issuesForCriterion.value
  const c = issues.filter((i) => i.severity === 'critical').length
  const w = issues.filter((i) => i.severity === 'warning').length
  const n = issues.filter((i) => i.severity === 'info').length
  return `${c} critical · ${w} warning · ${n} info`
})

// -- Reviewer model: read from any subtask in this criterion --
const reviewerModel = computed(() => row.value?.subtasks[0]?.task.model ?? '—')

// -- Filters --
const severityFilter = ref<FindingSeverity | 'all'>('all')

const severityOptions: ChipOption<FindingSeverity | 'all'>[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical', activeBg: 'var(--critical-bg)', activeColor: 'var(--critical-text)' },
  { value: 'warning', label: 'Warning', activeBg: 'var(--warning-bg)', activeColor: 'var(--warning-text)' },
  { value: 'info', label: 'Info', activeBg: 'var(--info-bg)', activeColor: 'var(--info-text)' },
]

const filteredIssues = computed(() => {
  const all = issuesForCriterion.value
  if (severityFilter.value === 'all') return all
  return all.filter((i) => i.severity === severityFilter.value)
})

// -- Navigation --

function navigateToSubtask(taskId: string): void {
  void router.push({
    name: 'subtask',
    params: { planId: props.planId, taskId },
  })
}

// -- Partition instruction (copied onto ModuleSummary by the plan-builder) --
const partitionInstruction = computed(() => {
  return run.plan.value?.modules[props.criterionId]?.partition ?? '—'
})
</script>

<template>
  <div>
    <Crumb
      :items="[
        { label: 'Reviews', to: { name: 'runs' } },
        { label: planId, to: { name: 'run', params: { planId } } },
        { label: criterionId },
      ]"
    />

    <div v-if="!run.plan.value" class="empty">Loading…</div>
    <div v-else-if="!row" class="empty">
      Criterion <strong>{{ criterionId }}</strong> not found in this run.
    </div>
    <template v-else>
      <Meta
        :items="[
          { label: 'Partition instruction', value: partitionInstruction },
          { label: 'Partitioner model', value: decision?.model ?? '—', mono: true },
          { label: 'Reviewer model', value: reviewerModel, mono: true },
          { label: 'Matched files', value: matchedFiles.length },
        ]"
      />

      <Collapse :title="`Matched files (${matchedFiles.length})`">
        <div class="files">
          <div v-for="f in matchedFiles" :key="f" class="file">{{ f }}</div>
        </div>
      </Collapse>

      <div class="stats">
        <Stat
          label="Elapsed"
          :value="elapsedDisplay"
          :sub="`${completedReviewerCount}/${row.subtasks.length} subtasks done`"
        />
        <TokenCard label="Partitioner" :bucket="partitionerTokens" />
        <TokenCard label="Reviewers" :bucket="reviewerTokens" />
        <Stat
          label="Issues"
          :value="issuesForCriterion.length"
          :sub="issuesForCriterion.length > 0 ? issueBreakdown : 'clean'"
        />
      </div>

      <div v-if="decision" class="reasoning">
        <div class="label">Partitioner reasoning</div>
        <div class="text">{{ decision.reasoning }}</div>
      </div>

      <h3 class="section-title">Subtasks</h3>
      <div class="subtask-list">
        <SubtaskRowItem
          v-for="sub in row.subtasks"
          :key="sub.task_id"
          :subtask="sub"
          @navigate="navigateToSubtask"
        />
      </div>

      <h3 class="section-title">Issues ({{ issuesForCriterion.length }})</h3>
      <FilterChips v-model="severityFilter" :options="severityOptions" />
      <div v-if="filteredIssues.length === 0" class="empty">
        <template v-if="issuesForCriterion.length === 0">
          {{
            run.plan.value && (run.plan.value.step === 'complete' || run.plan.value.step === 'failed')
              ? 'No issues found.'
              : 'No issues found yet.'
          }}
        </template>
        <template v-else>No issues match the active filter.</template>
      </div>
      <IssuesTable v-else :plan-id="planId" :issues="filteredIssues" :show-criterion="false" />
    </template>
  </div>
</template>

<style scoped>
.stats {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.section-title {
  font-size: 13px;
  margin-bottom: 10px;
  margin-top: 16px;
}
.empty {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 20px 14px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
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
.reasoning {
  background: var(--surface-alt);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 14px;
  margin-bottom: 12px;
}
.reasoning .label {
  font-size: 9px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 6px;
}
.reasoning .text {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}
.subtask-list {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  margin-bottom: 20px;
  overflow: hidden;
}
</style>
