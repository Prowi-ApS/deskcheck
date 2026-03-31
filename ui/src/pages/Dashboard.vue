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
      <p class="subtitle">Your code reviews</p>
    </div>

    <div v-if="loading" class="loading">Loading...</div>

    <div v-else-if="runs.length === 0" class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" stroke-width="2" />
          <path d="M6 18h36" stroke="currentColor" stroke-width="2" />
          <circle cx="12" cy="14" r="1.5" fill="var(--color-critical)" />
          <circle cx="17" cy="14" r="1.5" fill="var(--color-warning)" />
          <circle cx="22" cy="14" r="1.5" fill="var(--color-complete)" />
          <path d="M14 26h20M14 31h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </div>
      <h2 class="empty-title">No review runs yet</h2>
      <p class="empty-description">
        Deskcheck runs AI-powered code reviews against your codebase.<br />
        Define criteria as markdown files, and get structured issues with code-level suggestions.
      </p>
      <div class="getting-started">
        <h3 class="steps-title">Get started</h3>
        <ol class="steps">
          <li>
            <span class="step-label">Initialize deskcheck in your project</span>
            <code class="step-command">deskcheck init</code>
          </li>
          <li>
            <span class="step-label">Add criteria to <code>deskcheck/criteria/</code></span>
            <span class="step-hint">Each criterion is a markdown file with review instructions</span>
          </li>
          <li>
            <span class="step-label">Run a review against your changes</span>
            <code class="step-command">deskcheck diff develop</code>
          </li>
        </ol>
      </div>
      <p class="empty-footer">
        Results will appear here automatically. This page refreshes every 2 seconds.
      </p>
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

.empty-state {
  max-width: 520px;
  margin: 3rem auto;
  text-align: center;
  padding: 2.5rem 2rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.empty-icon {
  color: var(--text-muted);
  margin-bottom: 1.25rem;
}

.empty-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.empty-description {
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 1.75rem;
}

.getting-started {
  text-align: left;
  background: var(--bg-expand);
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.25rem;
}

.steps-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--accent);
  margin-bottom: 0.75rem;
}

.steps {
  list-style: none;
  counter-reset: steps;
  padding: 0;
  margin: 0;
}

.steps li {
  counter-increment: steps;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 0 0.5rem 2rem;
  position: relative;
  font-size: 0.8rem;
  color: var(--text-primary);
}

.steps li + li {
  border-top: 1px solid var(--border);
}

.steps li::before {
  content: counter(steps);
  position: absolute;
  left: 0;
  top: 0.5rem;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--accent);
  font-family: var(--font-mono);
}

.step-label {
  font-weight: 500;
}

.step-label code {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  background: var(--bg-card);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

.step-command {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  background: var(--bg-card);
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  color: var(--accent);
  display: inline-block;
  border: 1px solid var(--border);
}

.step-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.empty-footer {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.loading {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
}
</style>
