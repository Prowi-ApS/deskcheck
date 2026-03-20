<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useSse } from '../composables/useSse'
import { useMarkdown } from '../composables/useMarkdown'
import type {
  ReviewPlan,
  ReviewResults,
  TaskStatus,
  FindingSeverity,
  FileFinding,
} from '../types'

// =============================================================================
// Sort / filter types
// =============================================================================

type TaskSortKey = 'task_id' | 'criterion' | 'duration' | 'cost' | 'findings'
type FileSortKey = 'path' | 'findings'
type FileFilter = 'all' | 'matched' | 'unmatched'
type ViewMode = 'overview' | 'file-detail'
type GroupMode = 'criterion' | 'severity'

// =============================================================================
// Data fetching
// =============================================================================

const route = useRoute()
const router = useRouter()
const { get } = useApi()
const { render: renderMarkdown } = useMarkdown()

const plan = ref<ReviewPlan | null>(null)
const results = ref<ReviewResults | null>(null)
const loading = ref(true)

const planId = computed(() => route.params.id as string)

async function fetchData() {
  try {
    const [planData, resultsData] = await Promise.all([
      get<ReviewPlan>(`/api/runs/${encodeURIComponent(planId.value)}/plan`),
      get<ReviewResults>(`/api/runs/${encodeURIComponent(planId.value)}/results`).catch(
        () => null,
      ),
    ])
    plan.value = planData
    results.value = resultsData
    loading.value = false
  } catch (err) {
    console.error('Failed to fetch run data:', err)
  }
}

const sseUrl = computed(() => `/api/events/${encodeURIComponent(planId.value)}`)
const { connect, disconnect } = useSse(sseUrl.value, () => {
  fetchData()
})

function goBack() {
  router.push('/')
}

onMounted(() => {
  fetchData()
  connect()
})

onUnmounted(() => {
  disconnect()
})

// =============================================================================
// View state
// =============================================================================

const viewMode = ref<ViewMode>('overview')
const selectedFilePath = ref<string | null>(null)

// Shared state
const activeSeverities = ref<Set<FindingSeverity>>(new Set(['critical', 'warning', 'info']))

// Overview state
const taskSortKey = ref<TaskSortKey>('task_id')
const taskSortAsc = ref(true)
const fileSortKey = ref<FileSortKey>('path')
const fileSortAsc = ref(true)
const fileFilter = ref<FileFilter>('all')

// File detail state
const groupMode = ref<GroupMode>('criterion')

// =============================================================================
// Overview computed
// =============================================================================

const completionPct = computed(() => {
  if (!results.value) return 0
  const c = results.value.completion
  if (c.total === 0) return 0
  return Math.round(((c.completed + c.errored) / c.total) * 100)
})

const usage = computed(() => results.value?.total_usage ?? null)

const runDuration = computed(() => {
  if (!plan.value?.started_at) return null
  const end = plan.value.completed_at ? new Date(plan.value.completed_at) : new Date()
  const ms = end.getTime() - new Date(plan.value.started_at).getTime()
  return formatDuration(ms)
})

interface TaskRow {
  task_id: string
  review_id: string
  criterionLabel: string
  files: string[]
  model: string
  status: TaskStatus
  duration_ms: number
  cost_usd: number
  critical: number
  warning: number
  info: number
  totalFindings: number
}

const taskRows = computed<TaskRow[]>(() => {
  if (!plan.value) return []
  const rows: TaskRow[] = []
  for (const [tid, task] of Object.entries(plan.value.tasks)) {
    const tr = results.value?.task_results[tid]
    let critical = 0, warning = 0, info = 0
    if (tr) {
      for (const f of tr.findings) {
        if (f.severity === 'critical') critical++
        else if (f.severity === 'warning') warning++
        else info++
      }
    }
    // Filter: non-complete tasks always show; complete tasks must have findings matching active severities
    if (task.status === 'complete') {
      const hasMatch =
        (activeSeverities.value.has('critical') && critical > 0) ||
        (activeSeverities.value.has('warning') && warning > 0) ||
        (activeSeverities.value.has('info') && info > 0) ||
        (critical + warning + info === 0) // always show clean tasks
      if (!hasMatch) continue
    }
    rows.push({
      task_id: tid,
      review_id: task.review_id,
      criterionLabel: task.review_id.split('/').pop() ?? task.review_id,
      files: task.files,
      model: task.model ?? '',
      status: task.status,
      duration_ms: tr?.usage?.duration_ms ?? 0,
      cost_usd: tr?.usage?.cost_usd ?? 0,
      critical, warning, info,
      totalFindings: critical + warning + info,
    })
  }
  rows.sort((a, b) => {
    let cmp = 0
    switch (taskSortKey.value) {
      case 'task_id': cmp = a.task_id.localeCompare(b.task_id); break
      case 'criterion': cmp = a.criterionLabel.localeCompare(b.criterionLabel); break
      case 'duration': cmp = a.duration_ms - b.duration_ms; break
      case 'cost': cmp = a.cost_usd - b.cost_usd; break
      case 'findings': cmp = a.totalFindings - b.totalFindings; break
    }
    return taskSortAsc.value ? cmp : -cmp
  })
  return rows
})

interface FileRow {
  path: string
  filename: string
  directory: string
  matched: boolean
  findingCount: number
}

const fileRows = computed<FileRow[]>(() => {
  if (!plan.value) return []
  const rows: FileRow[] = []
  const findingsPerFile: Record<string, number> = {}
  if (results.value) {
    for (const tr of Object.values(results.value.task_results)) {
      for (const f of tr.findings) {
        findingsPerFile[f.file] = (findingsPerFile[f.file] ?? 0) + 1
      }
    }
  }
  for (const f of plan.value.matched_files) {
    const parts = f.split('/')
    rows.push({ path: f, filename: parts[parts.length - 1] ?? f, directory: parts.slice(0, -1).join('/'), matched: true, findingCount: findingsPerFile[f] ?? 0 })
  }
  for (const f of plan.value.unmatched_files) {
    const parts = f.split('/')
    rows.push({ path: f, filename: parts[parts.length - 1] ?? f, directory: parts.slice(0, -1).join('/'), matched: false, findingCount: 0 })
  }
  return rows.filter(r => {
    if (fileFilter.value === 'matched') return r.matched
    if (fileFilter.value === 'unmatched') return !r.matched
    return true
  }).sort((a, b) => {
    let cmp = 0
    if (fileSortKey.value === 'path') cmp = a.path.localeCompare(b.path)
    else cmp = a.findingCount - b.findingCount
    return fileSortAsc.value ? cmp : -cmp
  })
})

const fileCounts = computed(() => {
  if (!plan.value) return { matched: 0, unmatched: 0, total: 0 }
  return {
    matched: plan.value.matched_files.length,
    unmatched: plan.value.unmatched_files.length,
    total: plan.value.matched_files.length + plan.value.unmatched_files.length,
  }
})

// =============================================================================
// File detail computed
// =============================================================================

const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'warning', 'info']

const selectedFileFindings = computed<FileFinding[]>(() => {
  if (!selectedFilePath.value || !results.value?.by_file[selectedFilePath.value]) return []
  return results.value.by_file[selectedFilePath.value].filter(f => activeSeverities.value.has(f.severity))
})

const selectedFileCounts = computed(() => {
  const counts = { critical: 0, warning: 0, info: 0, total: 0 }
  for (const f of selectedFileFindings.value) {
    counts[f.severity]++
    counts.total++
  }
  return counts
})

const selectedFileTotalCounts = computed(() => {
  if (!selectedFilePath.value || !results.value?.by_file[selectedFilePath.value]) return { total: 0 }
  return { total: results.value.by_file[selectedFilePath.value].length }
})

const selectedFileCriteria = computed(() => {
  if (!selectedFilePath.value || !results.value?.by_file[selectedFilePath.value]) return []
  return [...new Set(results.value.by_file[selectedFilePath.value].map(f => f.review_id))]
})

interface FindingGroup { key: string; label: string; findings: FileFinding[] }

const groupedFindings = computed<FindingGroup[]>(() => {
  const findings = selectedFileFindings.value
  if (findings.length === 0) return []

  if (groupMode.value === 'criterion') {
    const groups: Record<string, FileFinding[]> = {}
    for (const f of findings) {
      if (!groups[f.review_id]) groups[f.review_id] = []
      groups[f.review_id].push(f)
    }
    return Object.entries(groups).map(([key, items]) => ({
      key, label: key.split('/').pop() ?? key,
      findings: items.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)),
    }))
  }

  const groups: Record<string, FileFinding[]> = {}
  for (const sev of SEVERITY_ORDER) {
    const items = findings.filter(f => f.severity === sev)
    if (items.length > 0) groups[sev] = items
  }
  return Object.entries(groups).map(([key, items]) => ({
    key, label: key,
    findings: items.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
  }))
})

// =============================================================================
// Helpers
// =============================================================================

function severityOrder(s: FindingSeverity): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : 2
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${Math.floor(sec % 60)}s`
}

function formatCost(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

function toggleTaskSort(key: TaskSortKey) {
  if (taskSortKey.value === key) taskSortAsc.value = !taskSortAsc.value
  else { taskSortKey.value = key; taskSortAsc.value = key === 'task_id' || key === 'criterion' }
}

function toggleFileSort(key: FileSortKey) {
  if (fileSortKey.value === key) fileSortAsc.value = !fileSortAsc.value
  else { fileSortKey.value = key; fileSortAsc.value = key === 'path' }
}

function sortIndicator(active: boolean, asc: boolean): string {
  if (!active) return ''
  return asc ? ' \u25B2' : ' \u25BC'
}

function openFileDetail(filePath: string) {
  selectedFilePath.value = filePath
  viewMode.value = 'file-detail'
}

function backToOverview() {
  viewMode.value = 'overview'
  selectedFilePath.value = null
}

function toggleSeverity(sev: FindingSeverity) {
  const next = new Set(activeSeverities.value)
  if (next.has(sev)) { if (next.size > 1) next.delete(sev) }
  else next.add(sev)
  activeSeverities.value = next
}

function isSeverityActive(sev: FindingSeverity): boolean {
  return activeSeverities.value.has(sev)
}

function groupHeaderClass(group: FindingGroup): string {
  return groupMode.value === 'severity' ? `group-header-${group.key}` : ''
}

function selectedFileName(): string {
  if (!selectedFilePath.value) return ''
  const parts = selectedFilePath.value.split('/')
  return parts[parts.length - 1] ?? selectedFilePath.value
}
</script>

<template>
  <div v-if="loading" class="loading">Loading run...</div>

  <div v-else-if="plan" class="deskcheck-run">
    <!-- Header -->
    <header class="run-header">
      <div class="run-header-left">
        <button type="button" class="back-btn" @click="goBack">&larr; All runs</button>
        <div class="run-info">
          <h1 class="run-name">{{ plan.name }}</h1>
          <div class="run-meta">
            <span class="status-badge" :class="plan.status">{{ plan.status }}</span>
            <span class="meta-sep">{{ plan.source.type }} vs {{ plan.source.target }}</span>
            <span v-if="runDuration" class="meta-sep">{{ runDuration }}</span>
          </div>
        </div>
      </div>
      <div v-if="results" class="header-summary">
        <span v-if="results.summary.critical" class="pill critical">{{ results.summary.critical }} critical</span>
        <span v-if="results.summary.warning" class="pill warning">{{ results.summary.warning }} warning</span>
        <span v-if="results.summary.info" class="pill info">{{ results.summary.info }} info</span>
      </div>
    </header>

    <!-- ================================================================== -->
    <!-- OVERVIEW VIEW                                                       -->
    <!-- ================================================================== -->
    <div v-if="viewMode === 'overview'" class="content">
      <!-- Progress -->
      <section v-if="results" class="section" aria-label="Progress">
        <div class="progress-bar-container">
          <div class="progress-bar-track">
            <div class="progress-bar-fill" :style="{ width: completionPct + '%' }" />
          </div>
          <div class="progress-labels">
            <span>{{ results.completion.completed }}/{{ results.completion.total }} tasks</span>
            <span v-if="results.completion.in_progress > 0" class="running-count">{{ results.completion.in_progress }} running</span>
            <span v-if="results.completion.errored > 0" class="error-count">{{ results.completion.errored }} errored</span>
            <span class="pct">{{ completionPct }}%</span>
          </div>
        </div>
      </section>

      <!-- Usage -->
      <section v-if="usage" class="section" aria-label="Usage">
        <h2>Usage</h2>
        <div class="usage-grid">
          <div class="usage-card">
            <span class="usage-value">{{ formatCost(usage.cost_usd) }}</span>
            <span class="usage-label">Total Cost</span>
          </div>
          <div class="usage-card">
            <span class="usage-value">{{ (usage.input_tokens + usage.output_tokens).toLocaleString() }}</span>
            <span class="usage-label">Total Tokens</span>
          </div>
          <div class="usage-card">
            <span class="usage-value">{{ usage.input_tokens.toLocaleString() }}</span>
            <span class="usage-label">Input</span>
          </div>
          <div class="usage-card">
            <span class="usage-value">{{ usage.output_tokens.toLocaleString() }}</span>
            <span class="usage-label">Output</span>
          </div>
        </div>
      </section>

      <!-- Task table -->
      <section class="section" aria-label="Tasks">
        <div class="section-header">
          <h2>Tasks ({{ taskRows.length }})</h2>
          <div class="severity-filter">
            <button
              v-for="sev in SEVERITY_ORDER"
              :key="sev"
              class="filter-btn"
              :class="[sev, { active: isSeverityActive(sev) }]"
              type="button"
              @click="toggleSeverity(sev)"
            >
              {{ sev }}
            </button>
          </div>
        </div>
        <table class="task-table">
          <thead>
            <tr>
              <th class="sortable" @click="toggleTaskSort('task_id')">File{{ sortIndicator(taskSortKey === 'task_id', taskSortAsc) }}</th>
              <th class="sortable" @click="toggleTaskSort('criterion')">Criterion{{ sortIndicator(taskSortKey === 'criterion', taskSortAsc) }}</th>
              <th>Status</th>
              <th class="sortable num" @click="toggleTaskSort('duration')">Duration{{ sortIndicator(taskSortKey === 'duration', taskSortAsc) }}</th>
              <th class="sortable num" @click="toggleTaskSort('cost')">Cost{{ sortIndicator(taskSortKey === 'cost', taskSortAsc) }}</th>
              <th class="sortable num" @click="toggleTaskSort('findings')">Issues{{ sortIndicator(taskSortKey === 'findings', taskSortAsc) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in taskRows"
              :key="row.task_id"
              :class="['task-row', `status-${row.status}`, { clickable: row.status === 'complete' && row.totalFindings > 0 }]"
              @click="row.status === 'complete' && row.totalFindings > 0 ? openFileDetail(row.files[0]!) : undefined"
            >
              <td class="file-cell">
                <span class="task-filename">{{ row.files[0]?.split('/').pop() }}</span>
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
                  <span v-if="row.totalFindings === 0" class="clean-badge">clean</span>
                </template>
                <span v-else class="dim">&mdash;</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- File coverage table -->
      <section class="section" aria-label="File coverage">
        <h2>Files ({{ fileCounts.total }})</h2>
        <div class="file-filter-bar">
          <button type="button" class="file-filter-btn" :class="{ active: fileFilter === 'all' }" @click="fileFilter = 'all'">All ({{ fileCounts.total }})</button>
          <button type="button" class="file-filter-btn matched" :class="{ active: fileFilter === 'matched' }" @click="fileFilter = 'matched'">Matched ({{ fileCounts.matched }})</button>
          <button type="button" class="file-filter-btn unmatched" :class="{ active: fileFilter === 'unmatched' }" @click="fileFilter = 'unmatched'">Not covered ({{ fileCounts.unmatched }})</button>
        </div>
        <table class="file-table">
          <thead>
            <tr>
              <th class="sortable" @click="toggleFileSort('path')">File{{ sortIndicator(fileSortKey === 'path', fileSortAsc) }}</th>
              <th>Status</th>
              <th class="sortable num" @click="toggleFileSort('findings')">Findings{{ sortIndicator(fileSortKey === 'findings', fileSortAsc) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in fileRows"
              :key="row.path"
              :class="[{ unmatched: !row.matched, clickable: row.matched && row.findingCount > 0 }]"
              @click="row.matched && row.findingCount > 0 ? openFileDetail(row.path) : undefined"
            >
              <td class="file-cell">
                <span class="task-filename">{{ row.filename }}</span>
                <span class="task-filepath">{{ row.directory }}</span>
              </td>
              <td>
                <span v-if="row.matched" class="file-status-badge matched">reviewed</span>
                <span v-else class="file-status-badge not-covered">not covered</span>
              </td>
              <td class="num">
                <span v-if="row.findingCount > 0">{{ row.findingCount }}</span>
                <span v-else-if="row.matched" class="clean-badge">clean</span>
                <span v-else class="dim">&mdash;</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- ================================================================== -->
    <!-- FILE DETAIL VIEW                                                    -->
    <!-- ================================================================== -->
    <div v-else-if="viewMode === 'file-detail'" class="content">
      <div class="detail-nav">
        <button type="button" class="back-btn" @click="backToOverview">&larr; Back to overview</button>
      </div>

      <div class="detail-header">
        <div class="detail-header-top">
          <div>
            <h2 class="detail-filename">{{ selectedFileName() }}</h2>
            <div class="detail-path">{{ selectedFilePath }}</div>
            <div class="detail-summary">
              {{ selectedFileCounts.total }} findings
              <template v-if="selectedFileCounts.total !== selectedFileTotalCounts.total">
                ({{ selectedFileTotalCounts.total }} total)
              </template>
              from {{ selectedFileCriteria.length }} criteria
            </div>
          </div>
          <div class="detail-controls">
            <!-- Severity filter -->
            <div class="severity-filter">
              <button
                v-for="sev in SEVERITY_ORDER"
                :key="sev"
                class="filter-btn"
                :class="[sev, { active: isSeverityActive(sev) }]"
                type="button"
                @click="toggleSeverity(sev)"
              >
                {{ sev }}
              </button>
            </div>
            <!-- Group toggle -->
            <div class="group-toggle">
              <span class="group-toggle-label">Group by</span>
              <div class="toggle-buttons">
                <button type="button" class="toggle-btn" :class="{ active: groupMode === 'criterion' }" @click="groupMode = 'criterion'">Criterion</button>
                <button type="button" class="toggle-btn" :class="{ active: groupMode === 'severity' }" @click="groupMode = 'severity'">Severity</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="groupedFindings.length === 0" class="empty-state">
        No findings match the current filter.
      </div>

      <div v-for="group in groupedFindings" :key="group.key" class="finding-group">
        <div class="group-header" :class="groupHeaderClass(group)">
          <span class="group-name">{{ group.label }}</span>
          <span class="group-count">{{ group.findings.length }}</span>
        </div>
        <div
          v-for="(finding, idx) in group.findings"
          :key="`${group.key}-${idx}`"
          class="finding-card"
          :class="`severity-${finding.severity}`"
        >
          <div class="finding-top">
            <span class="severity-badge" :class="finding.severity">{{ finding.severity }}</span>
            <span v-if="finding.line" class="finding-line">line {{ finding.line }}</span>
            <span v-if="groupMode === 'severity'" class="finding-criterion">{{ finding.review_id.split('/').pop() }}</span>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="finding-description" v-html="renderMarkdown(finding.description)" />
          <div v-if="finding.suggestion" class="finding-suggestion">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <span v-html="renderMarkdown(finding.suggestion)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Header */
.run-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 1.25rem 2rem; background: var(--bg-secondary); border-bottom: 1px solid var(--border); }
.run-header-left { display: flex; align-items: flex-start; gap: 1rem; }
.run-name { font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem; }
.run-meta { display: flex; align-items: center; gap: 0.75rem; font-size: 0.75rem; color: var(--text-secondary); }
.status-badge { padding: 0.15rem 0.5rem; border-radius: 3px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.status-badge.complete { background: rgba(102, 187, 106, 0.2); color: var(--color-complete); }
.status-badge.executing { background: rgba(171, 71, 188, 0.2); color: var(--color-running); }
.status-badge.pending, .status-badge.planning, .status-badge.ready { background: rgba(90, 100, 120, 0.2); color: var(--text-muted); }
.meta-sep { color: var(--text-muted); }
.meta-sep::before { content: '\b7'; margin-right: 0.75rem; color: var(--border); }
.header-summary { display: flex; gap: 0.5rem; align-items: center; }
.pill { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; font-family: var(--font-mono); background: var(--bg-card); border: 1px solid var(--border); }
.pill.critical { color: var(--color-critical); }
.pill.warning { color: var(--color-warning); }
.pill.info { color: var(--color-info); }

/* Content */
.content { max-width: 1100px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }
.section { margin-bottom: 2rem; }
.section h2 { font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); margin-bottom: 1rem; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
.section-header h2 { margin-bottom: 0; }

/* Loading */
.loading { text-align: center; padding: 2rem; color: var(--text-secondary); }

/* Back button */
.back-btn { background: none; border: none; color: var(--accent); font-size: 0.85rem; cursor: pointer; padding: 0.25rem 0; display: inline-flex; align-items: center; gap: 0.35rem; }
.back-btn:hover { text-decoration: underline; }

/* Progress */
.progress-bar-track { height: 8px; background: var(--bg-card); border-radius: 4px; overflow: hidden; }
.progress-bar-fill { height: 100%; background: var(--color-complete); border-radius: 4px; transition: width 0.3s ease; }
.progress-labels { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); margin-top: 0.35rem; }
.error-count { color: var(--color-critical); }
.running-count { color: var(--color-running); }
.pct { font-family: var(--font-mono); font-weight: 600; color: var(--text-secondary); }

/* Usage */
.usage-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; }
.usage-card { display: flex; flex-direction: column; align-items: center; padding: 1rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; }
.usage-value { font-family: var(--font-mono); font-size: 1rem; font-weight: 600; }
.usage-label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 0.25rem; }

/* Task table */
.task-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.task-table thead th { padding: 0.4rem 0.75rem; text-align: left; font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); background: var(--bg-expand); border-bottom: 1px solid var(--border); }
.task-table tbody td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
.task-table tbody tr:last-child td { border-bottom: none; }
.task-table .num { text-align: right; font-family: var(--font-mono); font-size: 0.75rem; }
.task-table .sortable { cursor: pointer; user-select: none; }
.task-table .sortable:hover { color: var(--accent); }

.task-row { transition: background 0.1s ease; }
.task-row:hover { background: var(--bg-card-hover); }
.task-row.clickable { cursor: pointer; }
.task-row.clickable:hover { background: rgba(79, 195, 247, 0.08); }

/* Task status states */
.task-row.status-pending { opacity: 0.5; }
.task-row.status-in_progress { background: rgba(171, 71, 188, 0.06); }
.task-row.status-error { background: rgba(239, 83, 80, 0.04); }

.task-status-badge { font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; padding: 0.15rem 0.4rem; border-radius: 3px; }
.task-status-badge.complete { background: rgba(102, 187, 106, 0.15); color: var(--color-complete); }
.task-status-badge.in_progress { background: rgba(171, 71, 188, 0.2); color: var(--color-running); animation: pulse 2s ease-in-out infinite; }
.task-status-badge.pending { background: rgba(90, 100, 120, 0.2); color: var(--text-muted); }
.task-status-badge.error { background: rgba(239, 83, 80, 0.15); color: var(--color-critical); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.file-cell { display: flex; flex-direction: column; gap: 0.1rem; }
.task-filename { font-family: var(--font-mono); font-weight: 500; font-size: 0.8rem; }
.task-filepath { font-size: 0.65rem; color: var(--text-muted); }
.criterion-badge { font-size: 0.75rem; font-weight: 500; }
.model-badge { font-size: 0.6rem; color: var(--text-muted); background: var(--bg-expand); padding: 0.1rem 0.4rem; border-radius: 3px; font-family: var(--font-mono); margin-left: 0.4rem; }

.issues-cell { display: flex; gap: 0.25rem; justify-content: flex-end; align-items: center; }
.sev-count { font-family: var(--font-mono); font-size: 0.65rem; font-weight: 700; padding: 0.1rem 0.35rem; border-radius: 3px; }
.sev-count.critical { background: rgba(239, 83, 80, 0.2); color: var(--color-critical); }
.sev-count.warning { background: rgba(255, 167, 38, 0.15); color: var(--color-warning); }
.sev-count.info { background: rgba(79, 195, 247, 0.1); color: var(--color-info); }
.clean-badge { font-size: 0.65rem; color: var(--color-complete); font-style: italic; }
.dim { color: var(--text-muted); }

/* File filter & table */
.file-filter-bar { display: flex; gap: 0.35rem; margin-bottom: 0.75rem; }
.file-filter-btn { padding: 0.35rem 0.75rem; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--text-muted); font-size: 0.7rem; font-weight: 500; cursor: pointer; transition: all 0.15s ease; }
.file-filter-btn:hover { background: var(--bg-card-hover); }
.file-filter-btn.active { background: var(--bg-card); color: var(--accent); border-color: var(--accent); font-weight: 600; }
.file-filter-btn.matched.active { color: var(--color-complete); border-color: rgba(102, 187, 106, 0.4); }
.file-filter-btn.unmatched.active { color: var(--text-muted); border-color: var(--text-muted); }

.file-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.file-table thead th { padding: 0.4rem 0.75rem; text-align: left; font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); background: var(--bg-expand); border-bottom: 1px solid var(--border); }
.file-table tbody td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
.file-table tbody tr:last-child td { border-bottom: none; }
.file-table tbody tr:hover { background: var(--bg-card-hover); }
.file-table tbody tr.clickable { cursor: pointer; }
.file-table tbody tr.clickable:hover { background: rgba(79, 195, 247, 0.08); }
.file-table tbody tr.unmatched { opacity: 0.6; }
.file-table .num { text-align: right; font-family: var(--font-mono); font-size: 0.75rem; }
.file-table .sortable { cursor: pointer; user-select: none; }
.file-table .sortable:hover { color: var(--accent); }

.file-status-badge { font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; padding: 0.15rem 0.4rem; border-radius: 3px; }
.file-status-badge.matched { background: rgba(102, 187, 106, 0.15); color: var(--color-complete); }
.file-status-badge.not-covered { background: rgba(90, 100, 120, 0.2); color: var(--text-muted); }

/* ======================================================================== */
/* FILE DETAIL VIEW                                                          */
/* ======================================================================== */

.detail-nav { margin-bottom: 1rem; }

.detail-header { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
.detail-header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 1.5rem; }
.detail-filename { font-size: 1.1rem; font-weight: 600; font-family: var(--font-mono); }
.detail-path { font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 0.25rem; }
.detail-summary { font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.5rem; }

.detail-controls { display: flex; flex-direction: column; gap: 0.65rem; align-items: flex-end; flex-shrink: 0; }

/* Severity filter */
.severity-filter { display: flex; gap: 0.35rem; }
.filter-btn { padding: 0.3rem 0.6rem; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--text-muted); font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; cursor: pointer; transition: all 0.15s ease; }
.filter-btn:hover { background: var(--bg-card-hover); }
.filter-btn.active.critical { background: rgba(239, 83, 80, 0.15); border-color: rgba(239, 83, 80, 0.4); color: var(--color-critical); }
.filter-btn.active.warning { background: rgba(255, 167, 38, 0.12); border-color: rgba(255, 167, 38, 0.4); color: var(--color-warning); }
.filter-btn.active.info { background: rgba(79, 195, 247, 0.1); border-color: rgba(79, 195, 247, 0.3); color: var(--color-info); }

/* Group toggle */
.group-toggle { display: flex; align-items: center; gap: 0.5rem; }
.group-toggle-label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.toggle-buttons { display: flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.toggle-btn { padding: 0.3rem 0.65rem; border: none; background: transparent; color: var(--text-muted); font-size: 0.7rem; font-weight: 500; cursor: pointer; transition: all 0.15s ease; }
.toggle-btn + .toggle-btn { border-left: 1px solid var(--border); }
.toggle-btn:hover { background: var(--bg-card-hover); color: var(--text-secondary); }
.toggle-btn.active { background: var(--bg-card); color: var(--accent); font-weight: 600; }

/* Findings */
.empty-state { text-align: center; padding: 3rem 1rem; color: var(--text-muted); font-size: 0.85rem; }

.finding-group { margin-bottom: 1.5rem; }
.group-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; padding: 0.4rem 0; }
.group-name { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-secondary); }
.group-header-critical .group-name { color: var(--color-critical); }
.group-header-warning .group-name { color: var(--color-warning); }
.group-header-info .group-name { color: var(--color-info); }
.group-count { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); background: var(--bg-card); padding: 0.1rem 0.4rem; border-radius: 3px; }

.finding-card { padding: 0.75rem 1rem; background: var(--bg-card); border-radius: 6px; margin-bottom: 0.5rem; border-left: 3px solid transparent; }
.finding-card.severity-critical { border-left-color: var(--color-critical); }
.finding-card.severity-warning { border-left-color: var(--color-warning); }
.finding-card.severity-info { border-left-color: var(--color-info); }

.finding-top { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
.severity-badge { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.severity-badge.critical { background: rgba(239, 83, 80, 0.2); color: var(--color-critical); }
.severity-badge.warning { background: rgba(255, 167, 38, 0.15); color: var(--color-warning); }
.severity-badge.info { background: rgba(79, 195, 247, 0.1); color: var(--color-info); }
.finding-line { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); }
.finding-criterion { font-size: 0.6rem; color: var(--text-muted); background: var(--bg-expand); padding: 0.1rem 0.4rem; border-radius: 3px; margin-left: auto; }
.finding-description { font-size: 0.8rem; line-height: 1.5; color: var(--text-primary); }
.finding-description :deep(p) { margin: 0 0 0.4rem; }
.finding-description :deep(p:last-child) { margin-bottom: 0; }
.finding-description :deep(code) { font-family: var(--font-mono); font-size: 0.75rem; background: var(--bg-expand); padding: 0.1rem 0.3rem; border-radius: 3px; }
.finding-suggestion { margin-top: 0.5rem; padding: 0.5rem 0.75rem; background: var(--bg-expand); border-radius: 4px; font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5; }
.finding-suggestion :deep(p) { margin: 0 0 0.4rem; }
.finding-suggestion :deep(p:last-child) { margin-bottom: 0; }
.finding-suggestion :deep(code) { font-family: var(--font-mono); font-size: 0.7rem; background: var(--bg-card); padding: 0.1rem 0.3rem; border-radius: 3px; }
</style>
