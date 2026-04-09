<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { listRuns } from '../api'
import type { RunSummary } from '../types'
import ScopeBadge from '../components/ScopeBadge.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { formatRelative } from '../utils/format'

const runs = ref<RunSummary[]>([])
const error = ref<string | null>(null)
const loading = ref(false)

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const data = await listRuns()
    // Sort newest first by planId (which is a timestamp string).
    data.sort((a, b) => b.planId.localeCompare(a.planId))
    runs.value = data
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void refresh()
  // Cheap polling — runs list refreshes every 5s while the page is open.
  // Individual runs use SSE; this is just for "is there a new run?" updates.
  pollTimer = setInterval(() => void refresh(), 5000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

function totalIssues(r: RunSummary): number {
  return r.summary?.total ?? 0
}

function statusFor(r: RunSummary): string {
  // The backend's RunSummary.status is the plan status string.
  return r.status
}
</script>

<template>
  <div>
    <h2 class="title">Reviews</h2>
    <div v-if="error" class="error">Failed to load runs: {{ error }}</div>
    <div class="table">
      <div class="head row">
        <span>Plan ID</span>
        <span>Name</span>
        <span>Scope</span>
        <span>Status</span>
        <span>Issues</span>
        <span>Time</span>
      </div>
      <div v-if="!loading && runs.length === 0" class="empty">
        No deskcheck runs yet.
      </div>
      <RouterLink
        v-for="r in runs"
        :key="r.planId"
        :to="{ name: 'run', params: { planId: r.planId } }"
        class="row data"
      >
        <span class="planid">{{ r.planId }}</span>
        <span class="name">{{ r.name }}</span>
        <span><ScopeBadge :scope="r.scope" /></span>
        <span><StatusBadge :status="statusFor(r)" /></span>
        <span class="issues" :class="{ has: totalIssues(r) > 0 }">{{ totalIssues(r) }}</span>
        <span class="time">{{ formatRelative(r.createdAt) }}</span>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.title {
  font-size: 16px;
  margin-bottom: 14px;
}
.error {
  background: var(--critical-bg);
  border: 1px solid var(--critical-border);
  color: var(--critical-text);
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 12px;
}
.table {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 170px 1fr 110px 85px 60px 110px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
  text-decoration: none;
  color: inherit;
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
.planid {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent);
}
.name {
  font-size: 12px;
  color: var(--text);
}
.issues {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-dim);
}
.issues.has {
  color: var(--amber);
}
.time {
  font-size: 11px;
  color: var(--text-muted);
}
.empty {
  padding: 20px 14px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}
</style>
