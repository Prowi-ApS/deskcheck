<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { FileIssue } from '../types'
import SeverityBadge from './SeverityBadge.vue'

const props = defineProps<{
  planId: string
  issues: FileIssue[]
  showCriterion: boolean
}>()

const router = useRouter()

function navigate(issue: FileIssue): void {
  void router.push({
    name: 'subtask',
    params: { planId: props.planId, taskId: issue.task_id },
  })
}

function describeRefs(issue: FileIssue): string[] {
  return issue.references.map((r) => {
    const file = r.file.split('/').pop() ?? r.file
    return r.line != null ? `${file}:${r.line}` : file
  })
}
</script>

<template>
  <div class="table">
    <div class="head row" :class="{ 'with-criterion': showCriterion }">
      <span>Severity</span>
      <span v-if="showCriterion">Criterion</span>
      <span>File(s)</span>
      <span>Description</span>
    </div>
    <div
      v-for="issue in issues"
      :key="issue.issue_id"
      class="data row"
      :class="{ 'with-criterion': showCriterion }"
      @click="navigate(issue)"
    >
      <span><SeverityBadge :severity="issue.severity" /></span>
      <span v-if="showCriterion" class="criterion">{{ issue.review_id }}</span>
      <div class="refs">
        <div v-for="(r, i) in describeRefs(issue)" :key="i" class="ref">{{ r }}</div>
      </div>
      <span class="desc">{{ issue.description }}</span>
    </div>
  </div>
</template>

<style scoped>
.table {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 75px 1fr 2fr;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
  align-items: start;
  gap: 10px;
}
.row.with-criterion {
  grid-template-columns: 75px 110px 1fr 2fr;
}
.row:last-child {
  border-bottom: none;
}
.head {
  background: transparent;
  border-bottom: 1px solid var(--border);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
  padding: 8px 14px;
}
.data {
  cursor: pointer;
  transition: background 0.1s;
}
.data:hover {
  background: var(--surface-hover);
}
.criterion {
  font-size: 11px;
  color: var(--text-muted);
}
.refs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ref {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text);
}
.desc {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
}
</style>
