<script setup lang="ts">
import { computed } from 'vue'
import { useMarkdown } from '../composables/useMarkdown'
import type { Finding } from '../types'

const props = defineProps<{
  finding: Finding
}>()

const { render } = useMarkdown()

const descriptionHtml = computed(() => render(props.finding.description))
const suggestionHtml = computed(() =>
  props.finding.suggestion ? render(props.finding.suggestion) : null,
)

const location = computed(() => {
  if (!props.finding.file) return null
  return props.finding.file + (props.finding.line ? `:${props.finding.line}` : '')
})
</script>

<template>
  <div class="finding-card" :class="`severity-${finding.severity}`">
    <span class="severity" :class="finding.severity">{{ finding.severity }}</span>
    <span class="description" v-html="descriptionHtml" />
    <div v-if="location" class="location">{{ location }}</div>
    <div v-if="suggestionHtml" class="suggestion" v-html="suggestionHtml" />
  </div>
</template>

<style scoped>
.finding-card {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border);
  font-size: 0.8rem;
  border-left: 3px solid transparent;
}

.finding-card:last-child {
  border-bottom: none;
}

.finding-card.severity-critical {
  border-left-color: var(--color-critical);
}

.finding-card.severity-warning {
  border-left-color: var(--color-warning);
}

.finding-card.severity-info {
  border-left-color: var(--color-info);
}

.severity {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-right: var(--space-sm);
  vertical-align: middle;
}

.severity.critical {
  background: rgba(239, 83, 80, 0.2);
  color: var(--color-critical);
}

.severity.warning {
  background: rgba(255, 167, 38, 0.2);
  color: var(--color-warning);
}

.severity.info {
  background: rgba(79, 195, 247, 0.15);
  color: var(--color-info);
}

.description {
  color: var(--text-primary);
  line-height: 1.5;
}

.description :deep(p) {
  margin: 0;
  display: inline;
}

.description :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  background: var(--bg-secondary);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

.location {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: var(--space-sm);
}

.suggestion {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-secondary);
  border-radius: 4px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.suggestion :deep(p) {
  margin: 0;
}

.suggestion :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  background: var(--bg-expand);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}
</style>
