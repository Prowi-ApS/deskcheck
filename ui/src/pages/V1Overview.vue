<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useRun, useElapsed, type CriterionRow } from '../composables/useRun'
import { useRunSse } from '../composables/useRunSse'
import type { FindingSeverity, FileIssue } from '../types'
import Crumb from '../components/Crumb.vue'
import Pipeline from '../components/Pipeline.vue'
import Meta from '../components/Meta.vue'
import Stat from '../components/Stat.vue'
import TokenCard from '../components/TokenCard.vue'
import StatusDot from '../components/StatusDot.vue'
import Badge from '../components/Badge.vue'
import ScopeBadge from '../components/ScopeBadge.vue'
import FilterChips, { type ChipOption } from '../components/FilterChips.vue'
import IssuesTable from '../components/IssuesTable.vue'
import SubtaskRowItem from '../components/SubtaskRowItem.vue'
import { formatDuration, formatTokens, formatCost } from '../utils/format'

const props = defineProps<{ planId: string }>()
const router = useRouter()

const run = useRun(props.planId)
useRunSse(props.planId, run)

// -- Live elapsed --
const startedAt = computed(() => run.plan.value?.started_at ?? null)
const completedAt = computed(() => run.plan.value?.completed_at ?? null)
const elapsedMs = useElapsed(startedAt, completedAt)

// -- Filter state --
const severityFilter = ref<FindingSeverity | 'all'>('all')
const criterionFilter = ref<string[]>([])
const expanded = ref<Set<string>>(new Set())
const showAllSubtasks = ref<Set<string>>(new Set())

const SUBTASK_LIMIT = 6

function toggleExpanded(reviewId: string): void {
  const next = new Set(expanded.value)
  if (next.has(reviewId)) next.delete(reviewId)
  else next.add(reviewId)
  expanded.value = next
}

function toggleShowAll(reviewId: string): void {
  const next = new Set(showAllSubtasks.value)
  if (next.has(reviewId)) next.delete(reviewId)
  else next.add(reviewId)
  showAllSubtasks.value = next
}

function visibleSubtasks(row: CriterionRow): typeof row.subtasks {
  if (showAllSubtasks.value.has(row.review_id)) return row.subtasks
  if (row.subtasks.length <= 8) return row.subtasks
  return row.subtasks.slice(0, SUBTASK_LIMIT)
}

function hiddenCount(row: CriterionRow): number {
  if (showAllSubtasks.value.has(row.review_id)) return 0
  if (row.subtasks.length <= 8) return 0
  return row.subtasks.length - SUBTASK_LIMIT
}

// -- Derived data --

const filesInDiff = computed(() => {
  const p = run.plan.value
  if (!p) return 0
  return p.matched_files.length + p.unmatched_files.length
})

const matchedCriteriaCount = computed(() => {
  const p = run.plan.value
  return p ? Object.keys(p.modules).length : 0
})

const subtaskCount = computed(() => {
  const p = run.plan.value
  return p ? Object.keys(p.tasks).length : 0
})

const completionLabel = computed(() => {
  const p = run.plan.value
  if (!p) return ''
  const tasks = Object.values(p.tasks)
  const done = tasks.filter((t) => t.status === 'complete' || t.status === 'error').length
  return `${done}/${tasks.length} subtasks done`
})

// Merged token bucket for the whole run (partition + review combined)
const totalTokens = computed(() => {
  const b = run.tokenBreakdown.value
  return {
    uncached: b.partition.uncached + b.review.uncached,
    cacheCreate: b.partition.cacheCreate + b.review.cacheCreate,
    cacheRead: b.partition.cacheRead + b.review.cacheRead,
    totalInput: b.partition.totalInput + b.review.totalInput,
    output: b.partition.output + b.review.output,
    cost: b.partition.cost + b.review.cost,
  }
})

const tokenBreakdownLabel = computed(() => {
  const b = run.tokenBreakdown.value
  return `partition: ${formatCost(b.partition.cost)} · review: ${formatCost(b.review.cost)}`
})

const elapsedDisplay = computed(() => {
  if (elapsedMs.value <= 0) return '—'
  return formatDuration(elapsedMs.value)
})

const commandLabel = computed(() => {
  const p = run.plan.value
  if (!p) return ''
  return [p.invocation.command, ...p.invocation.args].join(' ')
})

const filteredIssues = computed<FileIssue[]>(() => {
  const all = run.allIssues.value
  return all.filter((i) => {
    if (severityFilter.value !== 'all' && i.severity !== severityFilter.value) return false
    if (criterionFilter.value.length > 0 && !criterionFilter.value.includes(i.review_id)) return false
    return true
  })
})

const severityOptions: ChipOption<FindingSeverity | 'all'>[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical', activeBg: 'var(--critical-bg)', activeColor: 'var(--critical-text)' },
  { value: 'warning', label: 'Warning', activeBg: 'var(--warning-bg)', activeColor: 'var(--warning-text)' },
  { value: 'info', label: 'Info', activeBg: 'var(--info-bg)', activeColor: 'var(--info-text)' },
]

const criterionChips = computed<ChipOption<string>[]>(() =>
  run.criterionRows.value.map((r) => ({ value: r.review_id, label: r.label })),
)

// -- Navigation --

function navigateToCriterion(reviewId: string): void {
  void router.push({
    name: 'criterion',
    params: { planId: props.planId, criterionId: reviewId },
  })
}

function navigateToSubtask(taskId: string): void {
  void router.push({
    name: 'subtask',
    params: { planId: props.planId, taskId },
  })
}

// -- Failure rendering helper --

const failureForCriterion = (reviewId: string): string | null => {
  const f = run.plan.value?.failure
  if (!f || f.review_id !== reviewId) return null
  return f.message
}
</script>

<template>
  <div>
    <Crumb
      :items="[
        { label: 'Reviews', to: { name: 'runs' } },
        { label: planId },
      ]"
    />

    <Pipeline :state="run.pipelineState.value" />

    <Meta
      v-if="run.plan.value"
      :items="[
        { label: 'Command', value: commandLabel, mono: true },
        { label: 'Scope' },
        { label: 'Files in diff', value: filesInDiff },
        { label: 'Matched criteria', value: matchedCriteriaCount },
        { label: 'Subtasks', value: subtaskCount },
      ]"
    >
      <template #Scope>
        <ScopeBadge :scope="run.plan.value.scope" />
      </template>
    </Meta>

    <div class="stats">
      <Stat label="Elapsed" :value="elapsedDisplay" :sub="completionLabel" />
      <TokenCard
        label="Tokens"
        :bucket="totalTokens"
        :breakdown="tokenBreakdownLabel"
      />
    </div>

    <h3 class="section-title">Criteria → Subtasks</h3>
    <div v-if="run.criterionRows.value.length === 0" class="empty">
      No criteria matched the files in this run.
    </div>
    <div v-else class="criterion-list">
      <div v-for="row in run.criterionRows.value" :key="row.review_id" class="criterion-block">
        <div class="criterion-row" @click="toggleExpanded(row.review_id)">
          <StatusDot :status="row.status" />
          <span
            class="criterion-id"
            @click.stop="navigateToCriterion(row.review_id)"
          >
            {{ row.label }}
          </span>
          <span class="meta-cell">{{ row.totalDurationMs > 0 ? formatDuration(row.totalDurationMs) : '—' }}</span>
          <span class="meta-cell">{{ formatTokens(row.tokens.totalInput + row.tokens.output) }} tokens</span>
          <span class="meta-cell">{{ formatCost(row.tokens.cost) }}</span>
          <span class="meta-cell">{{ row.subtasks.length }} subtasks</span>
          <Badge
            v-if="row.issueCount > 0"
            bg="var(--warning-bg)"
            color="var(--warning-text)"
            border="var(--warning-border)"
          >
            {{ row.issueCount }} {{ row.issueCount === 1 ? 'issue' : 'issues' }}
          </Badge>
          <span class="caret">{{ expanded.has(row.review_id) ? '▾' : '▸' }}</span>
        </div>

        <!-- Failure note for this criterion if it errored at the partitioner -->
        <div v-if="failureForCriterion(row.review_id)" class="criterion-failure">
          {{ failureForCriterion(row.review_id) }}
        </div>

        <template v-if="expanded.has(row.review_id)">
          <SubtaskRowItem
            v-for="sub in visibleSubtasks(row)"
            :key="sub.task_id"
            :subtask="sub"
            nested
            @navigate="navigateToSubtask"
          />
          <button
            v-if="hiddenCount(row) > 0"
            class="more"
            @click="toggleShowAll(row.review_id)"
          >
            + {{ hiddenCount(row) }} more
          </button>
        </template>
      </div>
    </div>

    <h3 class="section-title">
      Issues ({{ run.allIssues.value.length }} found{{
        run.plan.value && run.plan.value.step !== 'complete' && run.plan.value.step !== 'failed'
          ? ' so far'
          : ''
      }})
    </h3>
    <FilterChips v-model="severityFilter" :options="severityOptions" />
    <FilterChips
      v-if="criterionChips.length > 0"
      v-model="criterionFilter"
      :options="criterionChips"
      multi
    />
    <div v-if="filteredIssues.length === 0" class="empty">
      <template v-if="run.allIssues.value.length === 0">
        {{
          run.plan.value && (run.plan.value.step === 'complete' || run.plan.value.step === 'failed')
            ? 'No issues found.'
            : 'No issues found yet.'
        }}
      </template>
      <template v-else>No issues match the active filters.</template>
    </div>
    <IssuesTable
      v-else
      :plan-id="planId"
      :issues="filteredIssues"
      :show-criterion="true"
    />
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
  margin-top: 8px;
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
.criterion-list {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  margin-bottom: 20px;
  overflow: hidden;
}
.criterion-block {
  border-bottom: 1px solid var(--border-subtle);
}
.criterion-block:last-child {
  border-bottom: none;
}
.criterion-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.1s;
}
.criterion-row:hover {
  background: var(--surface-hover);
}
.criterion-id {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  cursor: pointer;
}
.criterion-id:hover {
  color: var(--accent);
}
.meta-cell {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.caret {
  color: var(--text-dim);
  font-size: 10px;
}
.criterion-failure {
  background: var(--critical-bg);
  border-top: 1px solid var(--critical-border);
  border-bottom: 1px solid var(--critical-border);
  color: var(--critical-text);
  padding: 8px 14px 8px 32px;
  font-size: 11px;
  font-family: var(--font-mono);
}
.more {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 11px;
  padding: 7px 14px 7px 32px;
  width: 100%;
  text-align: left;
  cursor: pointer;
  border-top: 1px solid var(--border-subtle);
}
.more:hover {
  background: var(--surface-hover);
}
</style>
