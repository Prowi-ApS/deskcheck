<script setup lang="ts">
import { ref, computed, provide, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useSse } from '../composables/useSse'
import { useRunData, RUN_DATA_KEY } from '../composables/useRunData'
import type { ReviewPlan, ReviewResults } from '../types'

import VerdictBanner from '../components/VerdictBanner.vue'
import TabBar, { type Tab } from '../components/TabBar.vue'
import IssuesTab from '../components/IssuesTab.vue'
import TasksTab from '../components/TasksTab.vue'
import FilesTab from '../components/FilesTab.vue'

// =============================================================================
// Data fetching
// =============================================================================

const route = useRoute()
const router = useRouter()
const { get } = useApi()

const plan = ref<ReviewPlan | null>(null)
const results = ref<ReviewResults | null>(null)
const loading = ref(true)

const planId = computed(() => route.params.id as string)

async function fetchData() {
  try {
    const [planData, resultsData] = await Promise.all([
      get<ReviewPlan>(`/api/runs/${encodeURIComponent(planId.value)}/plan`),
      get<ReviewResults>(`/api/runs/${encodeURIComponent(planId.value)}/results`).catch(() => null),
    ])
    plan.value = planData
    results.value = resultsData
    loading.value = false
  } catch (err) {
    console.error('Failed to fetch run data:', err)
  }
}

const sseUrl = computed(() => `/api/events/${encodeURIComponent(planId.value)}`)
const { connect, disconnect } = useSse(sseUrl.value, () => { fetchData() })

onMounted(() => { fetchData(); connect() })
onUnmounted(() => { disconnect() })

// =============================================================================
// Run data composable
// =============================================================================

const runData = useRunData(plan, results)
provide(RUN_DATA_KEY, runData)

// =============================================================================
// Tab state
// =============================================================================

type ActiveTab = 'issues' | 'tasks' | 'files'

const activeTab = ref<ActiveTab>('issues')

// Default tab: issues if complete with issues, tasks if running
const defaultTab = computed<ActiveTab>(() => {
  if (!results.value) return 'tasks'
  if (plan.value?.status !== 'complete') return 'tasks'
  if (results.value.summary.total > 0) return 'issues'
  return 'tasks'
})

// Set default tab once loading finishes (watch, not computed — no side effects in computed)
watch(loading, (isLoading) => {
  if (!isLoading) {
    activeTab.value = defaultTab.value
  }
}, { once: true })

const pendingFile = ref<string | null>(null)

const tabs = computed<Tab[]>(() => [
  { key: 'issues', label: 'Issues', count: results.value?.summary.total ?? undefined },
  { key: 'tasks', label: 'Tasks', count: plan.value ? Object.keys(plan.value.tasks).length : undefined },
  { key: 'files', label: 'Files', count: runData.fileCounts.value.total || undefined },
])

function goBack() { router.push('/') }
function onTabChange(key: string) { activeTab.value = key as ActiveTab }
function onNavigateToFile(filePath: string) {
  pendingFile.value = filePath
  activeTab.value = 'files'
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
            <span class="meta-sep">{{ plan.source.type === 'diff' ? `diff vs ${plan.source.target}` : plan.source.type === 'file' ? `reviewing files on ${plan.source.target}` : `${plan.source.type}: ${plan.source.target}` }}</span>
            <span v-if="runData.runDuration.value" class="meta-sep">{{ runData.runDuration.value }}</span>
          </div>
        </div>
      </div>
    </header>

    <VerdictBanner />
    <TabBar :tabs="tabs" :active-tab="activeTab" @update:active-tab="onTabChange" />

    <IssuesTab v-if="activeTab === 'issues'" />
    <TasksTab v-if="activeTab === 'tasks'" @navigate-to-file="onNavigateToFile" />
    <FilesTab v-if="activeTab === 'files'" :initial-file="pendingFile" @file-opened="pendingFile = null" />
  </div>
</template>

<style scoped>
.loading { text-align: center; padding: 2rem; color: var(--text-secondary); }

.run-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 1.25rem 2rem; background: var(--bg-secondary); border-bottom: 1px solid var(--border); }
.run-header-left { display: flex; align-items: flex-start; gap: 1rem; }
.run-name { font-size: 1rem; font-weight: 600; margin: 0 0 0.25rem; }
.run-meta { display: flex; align-items: center; gap: 0.75rem; font-size: 0.75rem; color: var(--text-secondary); }
.status-badge { padding: 0.15rem 0.5rem; border-radius: 3px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.status-badge.complete { background: rgba(102, 187, 106, 0.2); color: var(--color-complete); }
.status-badge.executing { background: rgba(171, 71, 188, 0.2); color: var(--color-running); }
.status-badge.pending, .status-badge.planning, .status-badge.ready { background: rgba(90, 100, 120, 0.2); color: var(--text-muted); }
.meta-sep { color: var(--text-muted); }
.meta-sep::before { content: '\b7'; margin-right: 0.75rem; color: var(--border); }
.back-btn { background: none; border: none; color: var(--accent); font-size: 0.85rem; cursor: pointer; padding: 0.25rem 0; }
.back-btn:hover { text-decoration: underline; }
</style>
