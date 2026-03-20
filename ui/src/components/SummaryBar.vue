<script setup lang="ts">
defineProps<{
  summary: {
    critical: number
    warning: number
    info: number
  }
}>()
</script>

<template>
  <div class="summary-bar">
    <div class="summary-item critical">
      <div class="count">{{ summary.critical }}</div>
      <div class="label">Critical</div>
    </div>
    <div class="summary-item warning">
      <div class="count">{{ summary.warning }}</div>
      <div class="label">Warning</div>
    </div>
    <div class="summary-item info">
      <div class="count">{{ summary.info }}</div>
      <div class="label">Info</div>
    </div>
  </div>
</template>

<style scoped>
.summary-bar {
  display: flex;
  gap: var(--space-md);
  margin-bottom: 1.5rem;
}

.summary-item {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: var(--space-md);
  text-align: center;
  flex: 1;
}

.summary-item .count {
  font-size: 1.2rem;
  font-weight: 700;
  font-family: var(--font-mono);
}

.summary-item .label {
  font-size: 0.7rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.summary-item.critical .count {
  color: var(--color-critical);
}

.summary-item.warning .count {
  color: var(--color-warning);
}

.summary-item.info .count {
  color: var(--color-info);
}

@media (max-width: 600px) {
  .summary-bar {
    flex-wrap: wrap;
    gap: var(--space-sm);
  }
  .summary-item {
    padding: var(--space-sm) var(--space-md);
  }
}
</style>
