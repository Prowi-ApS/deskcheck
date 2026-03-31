<script setup lang="ts">
import { computed } from 'vue'
import { useMarkdown } from '../composables/useMarkdown'
import ReferenceBlock from './ReferenceBlock.vue'
import type { FileIssue } from '../types'

const props = withDefaults(defineProps<{
  issue: FileIssue
  showCriterion?: boolean
  showSeverity?: boolean
}>(), {
  showSeverity: true,
})

const { render } = useMarkdown()

const descriptionHtml = computed(() => render(props.issue.description))
const suggestionHtml = computed(() =>
  props.issue.suggestion ? render(props.issue.suggestion) : null,
)

const isMultiFile = computed(() => {
  const files = new Set(props.issue.references.map(r => r.file))
  return files.size > 1
})

const fileCount = computed(() => {
  return new Set(props.issue.references.map(r => r.file)).size
})
</script>

<template>
  <div class="issue-card" :class="`severity-${issue.severity}`">
    <div class="issue-header">
      <span v-if="showSeverity" class="severity-badge" :class="issue.severity">{{ issue.severity }}</span>
      <span v-if="showCriterion" class="criterion-badge">{{ issue.review_id.split('/').pop() }}</span>
      <span v-if="isMultiFile" class="multi-file-badge">{{ fileCount }} files</span>
      <span v-if="issue.references[0]?.symbol" class="issue-symbol">{{ issue.references[0].symbol }}</span>
    </div>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="issue-description" v-html="descriptionHtml" />
    <div v-if="suggestionHtml" class="issue-suggestion">
      <div class="section-label suggestion-label">Suggestion</div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span v-html="suggestionHtml" />
    </div>
    <div v-if="issue.references.length > 0" class="issue-references">
      <div class="section-label">{{ issue.references.length === 1 ? 'Location' : 'Locations' }}</div>
      <ReferenceBlock
        v-for="(ref, idx) in issue.references"
        :key="idx"
        :reference="ref"
      />
    </div>
  </div>
</template>

<style scoped>
.issue-card { padding: 1rem 1.25rem; background: var(--bg-card); border-radius: 6px; margin-bottom: 0.6rem; border-left: 4px solid transparent; }
.issue-card.severity-critical { border-left-color: var(--color-critical); }
.issue-card.severity-warning { border-left-color: var(--color-warning); }
.issue-card.severity-info { border-left-color: var(--color-info); }

.issue-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
.severity-badge { display: inline-block; padding: 0.2rem 0.5rem; border-radius: 3px; font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.severity-badge.critical { background: rgba(239, 83, 80, 0.2); color: var(--color-critical); }
.severity-badge.warning { background: rgba(255, 167, 38, 0.15); color: var(--color-warning); }
.severity-badge.info { background: rgba(79, 195, 247, 0.1); color: var(--color-info); }

.criterion-badge { font-size: 0.6875rem; color: var(--text-muted); background: var(--bg-expand); padding: 0.15rem 0.5rem; border-radius: 3px; }
.multi-file-badge { font-size: 0.6875rem; font-weight: 600; color: var(--accent); background: rgba(79, 195, 247, 0.1); padding: 0.15rem 0.5rem; border-radius: 3px; }
.issue-symbol { font-family: var(--font-mono); font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-left: auto; }

.section-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 0.35rem; }
.suggestion-label { color: var(--accent); }

.issue-description { font-size: 0.85rem; line-height: 1.6; color: var(--text-primary); }
.issue-description :deep(p) { margin: 0 0 0.4rem; }
.issue-description :deep(p:last-child) { margin-bottom: 0; }
.issue-description :deep(code) { font-family: var(--font-mono); font-size: 0.75rem; background: var(--bg-expand); padding: 0.1rem 0.3rem; border-radius: 3px; overflow-wrap: break-word; }

.issue-suggestion { margin-top: 0.75rem; padding: 0.6rem 0.85rem; background: var(--bg-expand); border-left: 2px solid var(--accent); border-radius: 0 4px 4px 0; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5; }
.issue-suggestion :deep(p) { margin: 0 0 0.4rem; }
.issue-suggestion :deep(p:last-child) { margin-bottom: 0; }
.issue-suggestion :deep(code) { font-family: var(--font-mono); font-size: 0.75rem; background: var(--bg-card); padding: 0.1rem 0.3rem; border-radius: 3px; }

.issue-references { margin-top: 0.75rem; }
</style>
