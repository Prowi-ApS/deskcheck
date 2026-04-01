import { ref, computed, type Ref, type ComputedRef, type InjectionKey } from 'vue'
import type {
  ReviewPlan,
  ReviewResults,
  TaskStatus,
  FindingSeverity,
  FileIssue,
  TotalUsage,
} from '../types'
import { formatDuration } from '../utils/format'

// =============================================================================
// Exported types
// =============================================================================

export type TaskSortKey = 'task_id' | 'criterion' | 'duration' | 'cost' | 'findings'
export type FileSortKey = 'path' | 'findings'
export type FileFilter = 'all' | 'matched' | 'unmatched'
export type GroupMode = 'criterion' | 'severity'

export interface TaskRow {
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

export interface FileRow {
  path: string
  filename: string
  directory: string
  matched: boolean
  issueCount: number
  critical: number
  warning: number
  info: number
  criteriaCount: number
  criteriaIds: string[]
}

export interface IssueGroup {
  key: string
  label: string
  issues: FileIssue[]
}

export type Verdict = 'pass' | 'warn' | 'fail' | null

export interface RunData {
  plan: Ref<ReviewPlan | null>
  results: Ref<ReviewResults | null>
  // Derived
  completionPct: ComputedRef<number>
  usage: ComputedRef<TotalUsage | null>
  runDuration: ComputedRef<string | null>
  verdict: ComputedRef<Verdict>
  allIssues: ComputedRef<FileIssue[]>
  taskRows: ComputedRef<TaskRow[]>
  fileRows: ComputedRef<FileRow[]>
  fileCounts: ComputedRef<{ matched: number; unmatched: number; total: number }>
  // Shared filter state
  activeSeverities: Ref<Set<FindingSeverity>>
  toggleSeverity: (sev: FindingSeverity) => void
  // Task sort state
  taskSortKey: Ref<TaskSortKey>
  taskSortAsc: Ref<boolean>
  toggleTaskSort: (key: TaskSortKey) => void
  // File sort/filter state
  fileSortKey: Ref<FileSortKey>
  fileSortAsc: Ref<boolean>
  fileFilter: Ref<FileFilter>
  toggleFileSort: (key: FileSortKey) => void
  // Helpers
  issuesForFile: (path: string) => FileIssue[]
  groupIssues: (issues: FileIssue[], mode: GroupMode) => IssueGroup[]
  severityCounts: (issues: FileIssue[]) => { critical: number; warning: number; info: number; total: number }
}

export const RUN_DATA_KEY: InjectionKey<RunData> = Symbol('run-data')

// =============================================================================
// Composable
// =============================================================================

const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'warning', 'info']

function severityOrder(s: FindingSeverity): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : 2
}

export function useRunData(
  plan: Ref<ReviewPlan | null>,
  results: Ref<ReviewResults | null>,
): RunData {

  // -- Shared filter state --
  const activeSeverities = ref<Set<FindingSeverity>>(new Set(['critical', 'warning', 'info']))

  const ALL_SEVERITIES: Set<FindingSeverity> = new Set(['critical', 'warning', 'info'])

  function toggleSeverity(sev: FindingSeverity) {
    const current = activeSeverities.value
    if (current.size === 1 && current.has(sev)) {
      // Only this one active — click again restores all
      activeSeverities.value = new Set(ALL_SEVERITIES)
    } else if (current.size === ALL_SEVERITIES.size) {
      // All active — click isolates to just this one
      activeSeverities.value = new Set([sev])
    } else {
      // Subset active — toggle this one
      const next = new Set(current)
      if (next.has(sev)) {
        if (next.size > 1) next.delete(sev)
      } else {
        next.add(sev)
      }
      activeSeverities.value = next
    }
  }

  // -- Task sort state --
  const taskSortKey = ref<TaskSortKey>('task_id')
  const taskSortAsc = ref(true)

  function toggleTaskSort(key: TaskSortKey) {
    if (taskSortKey.value === key) taskSortAsc.value = !taskSortAsc.value
    else { taskSortKey.value = key; taskSortAsc.value = key === 'task_id' || key === 'criterion' }
  }

  // -- File sort/filter state --
  const fileSortKey = ref<FileSortKey>('path')
  const fileSortAsc = ref(true)
  const fileFilter = ref<FileFilter>('all')

  function toggleFileSort(key: FileSortKey) {
    if (fileSortKey.value === key) fileSortAsc.value = !fileSortAsc.value
    else { fileSortKey.value = key; fileSortAsc.value = key === 'path' }
  }

  // -- Derived --

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
    if (ms < 1000) return null // sub-second durations are noise
    return formatDuration(ms)
  })

  const verdict = computed<Verdict>(() => {
    if (!results.value) return null
    const s = results.value.summary
    if (results.value.status !== 'complete') return null
    if (s.critical > 0) return 'fail'
    if (s.warning > 0) return 'warn'
    return 'pass'
  })

  // Flat severity-sorted list of all unique issues
  const allIssues = computed<FileIssue[]>(() => {
    if (!results.value) return []
    const issues: FileIssue[] = []
    for (const tr of Object.values(results.value.task_results)) {
      for (const issue of tr.issues) {
        issues.push({
          ...issue,
          issue_id: issue.issue_id!,
          review_id: tr.review_id,
          task_id: tr.task_id,
        })
      }
    }
    issues.sort((a, b) => {
      const sevDiff = severityOrder(a.severity) - severityOrder(b.severity)
      if (sevDiff !== 0) return sevDiff
      const aFile = a.references[0]?.file ?? ''
      const bFile = b.references[0]?.file ?? ''
      return aFile.localeCompare(bFile)
    })
    return issues
  })

  const taskRows = computed<TaskRow[]>(() => {
    if (!plan.value) return []
    const rows: TaskRow[] = []
    for (const [tid, task] of Object.entries(plan.value.tasks)) {
      const tr = results.value?.task_results[tid]
      let critical = 0, warning = 0, info = 0
      if (tr) {
        for (const issue of tr.issues) {
          if (issue.severity === 'critical') critical++
          else if (issue.severity === 'warning') warning++
          else info++
        }
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

  const fileRows = computed<FileRow[]>(() => {
    if (!plan.value) return []
    const rows: FileRow[] = []

    // Build per-file issue counts from by_file (already deduped by backend)
    const byFile = results.value?.by_file ?? {}

    // Build file-to-criteria mapping from plan tasks
    const fileCriteria: Record<string, Set<string>> = {}
    if (plan.value) {
      for (const task of Object.values(plan.value.tasks)) {
        for (const f of task.files) {
          if (!fileCriteria[f]) fileCriteria[f] = new Set()
          fileCriteria[f].add(task.review_id)
        }
      }
    }

    function buildRow(f: string, matched: boolean): FileRow {
      const parts = f.split('/')
      const issues = byFile[f] ?? []
      let critical = 0, warning = 0, info = 0
      for (const issue of issues) {
        if (issue.severity === 'critical') critical++
        else if (issue.severity === 'warning') warning++
        else info++
      }
      const criteria = fileCriteria[f] ?? new Set()
      return {
        path: f,
        filename: parts[parts.length - 1] ?? f,
        directory: parts.slice(0, -1).join('/'),
        matched,
        issueCount: issues.length,
        critical, warning, info,
        criteriaCount: criteria.size,
        criteriaIds: [...criteria],
      }
    }

    for (const f of plan.value.matched_files) rows.push(buildRow(f, true))
    for (const f of plan.value.unmatched_files) rows.push(buildRow(f, false))

    return rows.filter(r => {
      if (fileFilter.value === 'matched') return r.matched
      if (fileFilter.value === 'unmatched') return !r.matched
      return true
    }).sort((a, b) => {
      let cmp = 0
      if (fileSortKey.value === 'path') cmp = a.path.localeCompare(b.path)
      else cmp = a.issueCount - b.issueCount
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

  // -- Helpers --

  function issuesForFile(path: string): FileIssue[] {
    return results.value?.by_file[path] ?? []
  }

  function groupIssues(issues: FileIssue[], mode: GroupMode): IssueGroup[] {
    if (issues.length === 0) return []

    if (mode === 'criterion') {
      const groups: Record<string, FileIssue[]> = {}
      for (const issue of issues) {
        if (!groups[issue.review_id]) groups[issue.review_id] = []
        groups[issue.review_id].push(issue)
      }
      return Object.entries(groups).map(([key, items]) => ({
        key,
        label: key.split('/').pop() ?? key,
        issues: items.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)),
      }))
    }

    // Group by severity
    const groups: Record<string, FileIssue[]> = {}
    for (const sev of SEVERITY_ORDER) {
      const items = issues.filter(f => f.severity === sev)
      if (items.length > 0) groups[sev] = items
    }
    return Object.entries(groups).map(([key, items]) => ({
      key,
      label: key === 'critical' ? 'Critical' : key === 'warning' ? 'Warning' : 'Info',
      issues: items.sort((a, b) => {
        const aLine = a.references[0]?.line ?? 0
        const bLine = b.references[0]?.line ?? 0
        return aLine - bLine
      }),
    }))
  }

  function severityCounts(issues: FileIssue[]): { critical: number; warning: number; info: number; total: number } {
    const counts = { critical: 0, warning: 0, info: 0, total: 0 }
    for (const issue of issues) {
      counts[issue.severity]++
      counts.total++
    }
    return counts
  }

  return {
    plan,
    results,
    completionPct,
    usage,
    runDuration,
    verdict,
    allIssues,
    taskRows,
    fileRows,
    fileCounts,
    activeSeverities,
    toggleSeverity,
    taskSortKey,
    taskSortAsc,
    toggleTaskSort,
    fileSortKey,
    fileSortAsc,
    fileFilter,
    toggleFileSort,
    issuesForFile,
    groupIssues,
    severityCounts,
  }
}
