<script setup lang="ts">
import { computed } from 'vue'
import type { TokenBucket } from '../composables/useRun'
import { formatTokens, formatCost } from '../utils/format'

const props = defineProps<{
  label: string
  bucket: TokenBucket
  /** Optional secondary breakdown label, e.g. "partition: 12k · review: 98k" */
  breakdown?: string
}>()

const totalInput = computed(() => formatTokens(props.bucket.totalInput))
const output = computed(() => formatTokens(props.bucket.output))
const cost = computed(() => formatCost(props.bucket.cost))

const cachePercent = computed(() => {
  if (props.bucket.totalInput === 0) return 0
  return Math.round((props.bucket.cacheRead / props.bucket.totalInput) * 100)
})

const detailLine = computed(() => {
  const parts: string[] = []
  if (props.bucket.cacheRead > 0) parts.push(`${formatTokens(props.bucket.cacheRead)} cached`)
  if (props.bucket.cacheCreate > 0) parts.push(`${formatTokens(props.bucket.cacheCreate)} new cache`)
  if (props.bucket.uncached > 0) parts.push(`${formatTokens(props.bucket.uncached)} uncached`)
  return parts.join(' · ')
})
</script>

<template>
  <div class="token-card">
    <div class="header">
      <div class="label">{{ label }}</div>
      <div class="cost">{{ cost }}</div>
    </div>
    <div class="row">
      <div class="col">
        <div class="col-label">Input</div>
        <div class="col-value">{{ totalInput }}</div>
      </div>
      <div class="col">
        <div class="col-label">Output</div>
        <div class="col-value">{{ output }}</div>
      </div>
      <div v-if="cachePercent > 0" class="col">
        <div class="col-label">Cached</div>
        <div class="col-value cache">{{ cachePercent }}%</div>
      </div>
    </div>
    <div v-if="detailLine" class="detail">{{ detailLine }}</div>
    <div v-if="breakdown" class="detail">{{ breakdown }}</div>
  </div>
</template>

<style scoped>
.token-card {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 12px 16px;
  flex: 1;
  min-width: 180px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}
.label {
  font-size: 9px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.cost {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  font-family: var(--font-mono);
}
.row {
  display: flex;
  gap: 16px;
  margin-bottom: 6px;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.col-label {
  font-size: 9px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.col-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  font-family: var(--font-mono);
  letter-spacing: -0.5px;
}
.col-value.cache {
  color: var(--green);
}
.detail {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}
</style>
