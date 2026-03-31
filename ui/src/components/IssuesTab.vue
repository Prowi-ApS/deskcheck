<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { RUN_DATA_KEY, type GroupMode } from '../composables/useRunData'
import type { FindingSeverity } from '../types'
import IssueCard from './IssueCard.vue'

const data = inject(RUN_DATA_KEY)!

const groupMode = ref<GroupMode>('severity')

const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'warning', 'info']

const filteredIssues = computed(() =>
  data.allIssues.value.filter(i => data.activeSeverities.value.has(i.severity))
)

const grouped = computed(() => {
  if (groupMode.value === 'criterion' || groupMode.value === 'severity') {
    return data.groupIssues(filteredIssues.value, groupMode.value)
  }
  return []
})

const showGrouped = computed(() => grouped.value.length > 0)
</script>

<template>
  <div class="issues-tab">
    <!-- Controls -->
    <div class="issues-controls">
      <div class="severity-filter">
        <button
          v-for="sev in SEVERITY_ORDER"
          :key="sev"
          class="filter-btn"
          :class="[sev, { active: data.activeSeverities.value.has(sev) }]"
          type="button"
          @click="data.toggleSeverity(sev)"
        >
          {{ sev.charAt(0).toUpperCase() }}
          <span class="filter-count">{{ data.results.value?.summary[sev] ?? 0 }}</span>
        </button>
      </div>
      <div class="group-toggle">
        <span class="group-label">Group by</span>
        <div class="toggle-buttons">
          <button type="button" class="toggle-btn" :class="{ active: groupMode === 'severity' }" @click="groupMode = 'severity'">Severity</button>
          <button type="button" class="toggle-btn" :class="{ active: groupMode === 'criterion' }" @click="groupMode = 'criterion'">Criterion</button>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="filteredIssues.length === 0" class="empty-state">
      <template v-if="data.allIssues.value.length === 0">No issues found — looking good.</template>
      <template v-else>No issues match the current filter.</template>
    </div>

    <!-- Grouped issue list -->
    <div v-if="showGrouped">
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
  </div>
</template>

<style scoped>
.issues-tab { max-width: 1100px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }

.issues-controls { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; }

.severity-filter { display: flex; gap: 0.35rem; }
.filter-btn { padding: 0.3rem 0.6rem; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--text-muted); font-size: 0.7rem; font-weight: 600; cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; gap: 0.3rem; }
.filter-btn:hover { background: var(--bg-card-hover); }
.filter-btn.active.critical { background: rgba(239, 83, 80, 0.15); border-color: rgba(239, 83, 80, 0.4); color: var(--color-critical); }
.filter-btn.active.warning { background: rgba(255, 167, 38, 0.12); border-color: rgba(255, 167, 38, 0.4); color: var(--color-warning); }
.filter-btn.active.info { background: rgba(79, 195, 247, 0.1); border-color: rgba(79, 195, 247, 0.3); color: var(--color-info); }
.filter-count { font-family: var(--font-mono); font-size: 0.6rem; }

.group-toggle { display: flex; align-items: center; gap: 0.5rem; }
.group-label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.toggle-buttons { display: flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.toggle-btn { padding: 0.3rem 0.65rem; border: none; background: transparent; color: var(--text-muted); font-size: 0.7rem; font-weight: 500; cursor: pointer; transition: all 0.15s ease; }
.toggle-btn + .toggle-btn { border-left: 1px solid var(--border); }
.toggle-btn:hover { background: var(--bg-card-hover); color: var(--text-secondary); }
.toggle-btn.active { background: var(--bg-card); color: var(--accent); font-weight: 600; }

.empty-state { text-align: center; padding: 3rem 1rem; color: var(--text-muted); font-size: 0.9rem; }

.issue-group { margin-bottom: 1.5rem; }
.group-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; padding: 0.4rem 0; }
.group-name { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-secondary); }
.group-header-critical .group-name { color: var(--color-critical); }
.group-header-warning .group-name { color: var(--color-warning); }
.group-header-info .group-name { color: var(--color-info); }
.group-count { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); background: var(--bg-card); padding: 0.1rem 0.4rem; border-radius: 3px; }
</style>
