<script setup lang="ts">
import { computed } from 'vue'
import { useMarkdown } from '../composables/useMarkdown'
import type { Issue } from '../types'

const props = defineProps<{
  issue: Issue
}>()

const { render } = useMarkdown()

const descriptionHtml = computed(() => render(props.issue.description))
const suggestionHtml = computed(() =>
  props.issue.suggestion ? render(props.issue.suggestion) : null,
)
</script>

<template>
  <div class="issue-card" :class="`severity-${issue.severity}`">
    <span class="severity" :class="issue.severity">{{ issue.severity }}</span>
    <span class="description" v-html="descriptionHtml" />

    <!-- References -->
    <div v-for="(ref, idx) in issue.references" :key="idx" class="reference">
      <div class="ref-location">
        <span v-if="ref.symbol" class="ref-symbol">{{ ref.symbol }}</span>
        <span class="ref-file">{{ ref.file }}<template v-if="ref.line">:{{ ref.line }}</template></span>
        <span v-if="ref.note" class="ref-note">{{ ref.note }}</span>
      </div>
      <div v-if="ref.code" class="ref-code">
        <pre><code>{{ ref.code }}</code></pre>
      </div>
      <div v-if="ref.suggestedCode" class="ref-suggested">
        <div class="ref-suggested-label">Suggested:</div>
        <pre><code>{{ ref.suggestedCode }}</code></pre>
      </div>
    </div>

    <div v-if="suggestionHtml" class="suggestion" v-html="suggestionHtml" />
  </div>
</template>

<style scoped>
.issue-card {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border);
  font-size: 0.8rem;
  border-left: 3px solid transparent;
}

.issue-card:last-child {
  border-bottom: none;
}

.issue-card.severity-critical {
  border-left-color: var(--color-critical);
}

.issue-card.severity-warning {
  border-left-color: var(--color-warning);
}

.issue-card.severity-info {
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

.reference {
  margin-top: var(--space-sm);
  padding-left: 0.5rem;
  border-left: 2px solid var(--border);
}

.ref-location {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--text-muted);
}

.ref-symbol {
  font-weight: 600;
  color: var(--text-secondary);
}

.ref-note {
  font-style: italic;
  font-family: inherit;
  font-size: 0.65rem;
}

.ref-code, .ref-suggested {
  margin-top: 0.25rem;
}

.ref-code pre, .ref-suggested pre {
  margin: 0;
  padding: 0.4rem 0.6rem;
  background: var(--bg-secondary);
  border-radius: 4px;
  font-size: 0.7rem;
  overflow-x: auto;
}

.ref-suggested-label {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 0.15rem;
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
