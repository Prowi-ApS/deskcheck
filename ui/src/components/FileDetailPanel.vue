<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { RUN_DATA_KEY, type GroupMode } from '../composables/useRunData'
import type { FindingSeverity } from '../types'
import IssueCard from './IssueCard.vue'

const props = defineProps<{ filePath: string }>()
const emit = defineEmits<{ close: [] }>()

const data = inject(RUN_DATA_KEY)!

const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'warning', 'info']
const groupMode = ref<GroupMode>('criterion')

const fileIssues = computed(() =>
  data.issuesForFile(props.filePath).filter(i => data.activeSeverities.value.has(i.severity))
)

const counts = computed(() => data.severityCounts(fileIssues.value))
const totalCounts = computed(() => ({ total: data.issuesForFile(props.filePath).length }))

// Get criteria from fileRows (plan data) — correct even for files with zero issues
const fileRowData = computed(() =>
  data.fileRows.value.find(r => r.path === props.filePath)
)
const criteria = computed(() => fileRowData.value?.criteriaIds ?? [])
const criteriaCount = computed(() => fileRowData.value?.criteriaCount ?? 0)

const grouped = computed(() => data.groupIssues(fileIssues.value, groupMode.value))

function fileName(): string {
  const parts = props.filePath.split('/')
  return parts[parts.length - 1] ?? props.filePath
}
</script>

<template>
  <div class="file-detail">
    <button type="button" class="back-btn" @click="emit('close')">&larr; Back to file list</button>

    <div class="detail-header">
      <div>
        <h3 class="detail-filename">{{ fileName() }}</h3>
        <div class="detail-path">{{ filePath }}</div>
        <div class="detail-summary">
          {{ counts.total }} issues
          <template v-if="counts.total !== totalCounts.total">({{ totalCounts.total }} total)</template>
          from {{ criteriaCount }} criteria
        </div>
      </div>
      <div class="detail-controls">
        <div class="severity-filter">
          <button
            v-for="sev in SEVERITY_ORDER"
            :key="sev"
            class="filter-btn"
            :class="[sev, { active: data.activeSeverities.value.has(sev) }]"
            type="button"
            @click="data.toggleSeverity(sev)"
          >{{ sev }}</button>
        </div>
        <div class="group-toggle">
          <span class="group-label">Group by</span>
          <div class="toggle-buttons">
            <button type="button" class="toggle-btn" :class="{ active: groupMode === 'criterion' }" @click="groupMode = 'criterion'">Criterion</button>
            <button type="button" class="toggle-btn" :class="{ active: groupMode === 'severity' }" @click="groupMode = 'severity'">Severity</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="fileIssues.length === 0 && totalCounts.total === 0" class="clean-state">
      <p>Reviewed by {{ criteriaCount }} criteria — no issues found.</p>
      <ul v-if="criteria.length > 0" class="criteria-list">
        <li v-for="c in criteria" :key="c">{{ c.split('/').pop() }}</li>
      </ul>
    </div>

    <div v-else-if="grouped.length === 0" class="empty-state">
      No issues match the current filter.
    </div>

    <div v-for="group in grouped" :key="group.key" class="issue-group">
      <div class="group-header" :class="`group-header-${group.key}`">
        <span class="group-name">{{ group.label }}</span>
        <span class="group-count">{{ group.issues.length }}</span>
      </div>
      <IssueCard
        v-for="issue in group.issues"
        :key="issue.issue_id"
        :issue="issue"
        :show-criterion="groupMode === 'severity'"
      />
    </div>
  </div>
</template>

<style scoped>
.file-detail { padding-top: 0.5rem; }
.back-btn { background: none; border: none; color: var(--accent); font-size: 0.8rem; cursor: pointer; padding: 0.25rem 0; margin-bottom: 0.75rem; }
.back-btn:hover { text-decoration: underline; }

.detail-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1.5rem; margin-bottom: 1.25rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border); }
.detail-filename { font-size: 1rem; font-weight: 600; font-family: var(--font-mono); margin: 0; }
.detail-path { font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 0.15rem; }
.detail-summary { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.35rem; }

.detail-controls { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-end; flex-shrink: 0; }

.severity-filter { display: flex; gap: 0.3rem; }
.filter-btn { padding: 0.25rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--text-muted); font-size: 0.65rem; font-weight: 600; text-transform: uppercase; cursor: pointer; }
.filter-btn:hover { background: var(--bg-card-hover); }
.filter-btn.active.critical { background: rgba(239, 83, 80, 0.15); border-color: rgba(239, 83, 80, 0.4); color: var(--color-critical); }
.filter-btn.active.warning { background: rgba(255, 167, 38, 0.12); border-color: rgba(255, 167, 38, 0.4); color: var(--color-warning); }
.filter-btn.active.info { background: rgba(79, 195, 247, 0.1); border-color: rgba(79, 195, 247, 0.3); color: var(--color-info); }

.group-toggle { display: flex; align-items: center; gap: 0.5rem; }
.group-label { font-size: 0.6rem; color: var(--text-muted); text-transform: uppercase; }
.toggle-buttons { display: flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.toggle-btn { padding: 0.25rem 0.5rem; border: none; background: transparent; color: var(--text-muted); font-size: 0.65rem; cursor: pointer; }
.toggle-btn + .toggle-btn { border-left: 1px solid var(--border); }
.toggle-btn.active { background: var(--bg-card); color: var(--accent); font-weight: 600; }

.clean-state, .empty-state { text-align: center; padding: 2rem 1rem; color: var(--text-muted); font-size: 0.85rem; }
.clean-state p { margin: 0 0 0.5rem; }
.criteria-list { list-style: none; padding: 0; margin: 0; font-size: 0.75rem; color: var(--text-secondary); }
.criteria-list li::before { content: '— '; color: var(--text-muted); }

.issue-group { margin-bottom: 1.25rem; }
.group-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; padding: 0.3rem 0; }
.group-name { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-secondary); }
.group-header-critical .group-name { color: var(--color-critical); }
.group-header-warning .group-name { color: var(--color-warning); }
.group-header-info .group-name { color: var(--color-info); }
.group-count { font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-muted); background: var(--bg-card); padding: 0.1rem 0.35rem; border-radius: 3px; }
</style>
