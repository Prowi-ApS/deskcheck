<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import type { RunSummary } from '../types'
import RunCard from '../components/RunCard.vue'

const router = useRouter()
const { get } = useApi()

const runs = ref<RunSummary[]>([])
const loading = ref(true)
let pollTimer: ReturnType<typeof setInterval> | null = null

async function fetchRuns() {
  try {
    const data = await get<RunSummary[]>('/api/runs')
    runs.value = data.slice().sort((a, b) => b.planId.localeCompare(a.planId))
    loading.value = false
  } catch (err) {
    console.error('Failed to fetch runs:', err)
  }
}

function goToRun(planId: string) {
  router.push(`/run/${planId}`)
}

onMounted(() => {
  fetchRuns()
  pollTimer = setInterval(fetchRuns, 2000)
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<template>
  <div class="dashboard">
    <div class="header">
      <h1>Deskcheck</h1>
      <p class="subtitle">Code review runs</p>
    </div>

    <div v-if="loading" class="loading">Loading...</div>

    <div v-else-if="runs.length === 0" class="empty">
      No deskcheck runs found.<br />
      Run <code>deskcheck diff develop</code> to start one.
    </div>

    <div v-else class="runs-grid">
      <RunCard
        v-for="run in runs"
        :key="run.planId"
        :run="run"
        @click="goToRun(run.planId)"
      />
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 2rem 3rem;
}

.header {
  margin-bottom: 2rem;
}

.header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.header .subtitle {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

.runs-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.empty {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--text-secondary);
}

.empty code {
  font-family: var(--font-mono);
  background: var(--bg-card);
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-size: 0.85rem;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
}
</style>
