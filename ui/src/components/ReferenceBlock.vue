<script setup lang="ts">
import type { Reference } from '../types'

defineProps<{ reference: Reference }>()

function copyPath(ref: Reference) {
  const text = ref.line ? `${ref.file}:${ref.line}` : ref.file
  navigator.clipboard.writeText(text)
}
</script>

<template>
  <div class="ref-block">
    <div class="ref-header">
      <span class="ref-path" role="button" tabindex="0" @click="copyPath(reference)" @keydown.enter="copyPath(reference)" title="Click to copy">{{ reference.file }}<template v-if="reference.line">:{{ reference.line }}</template></span>
      <span v-if="reference.symbol" class="ref-symbol">in <strong>{{ reference.symbol }}</strong></span>
    </div>
    <div v-if="reference.note" class="ref-note">{{ reference.note }}</div>
    <div v-if="reference.code && reference.suggestedCode" class="ref-diff">
      <div class="ref-diff-col current">
        <div class="ref-diff-label">Current code</div>
        <pre><code>{{ reference.code }}</code></pre>
      </div>
      <div class="ref-diff-col suggested">
        <div class="ref-diff-label">Suggested fix</div>
        <pre><code>{{ reference.suggestedCode }}</code></pre>
      </div>
    </div>
    <div v-else-if="reference.code" class="ref-code-only">
      <pre><code>{{ reference.code }}</code></pre>
    </div>
    <div v-else-if="reference.suggestedCode" class="ref-suggested-only">
      <div class="ref-diff-label suggested-label">Suggested fix</div>
      <pre><code>{{ reference.suggestedCode }}</code></pre>
    </div>
  </div>
</template>

<style scoped>
.ref-block { margin-top: 0.75rem; padding: 0.6rem 0.85rem; border-left: 2px solid var(--border); background: var(--bg-expand); border-radius: 0 4px 4px 0; }
.ref-header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.ref-path { font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; color: var(--accent); cursor: pointer; }
.ref-path:hover { text-decoration: underline; }
.ref-symbol { font-size: 0.75rem; color: var(--text-muted); }
.ref-symbol strong { font-family: var(--font-mono); font-weight: 600; color: var(--text-secondary); }
.ref-note { font-size: 0.75rem; font-style: italic; color: var(--text-muted); margin-top: 0.2rem; }

.ref-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.5rem; }
@media (max-width: 768px) { .ref-diff { grid-template-columns: 1fr; } }
.ref-diff-label { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.2rem; }
.ref-diff-col pre { margin: 0; padding: 0.5rem 0.75rem; border-radius: 4px; font-size: 0.75rem; font-family: var(--font-mono); white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
.ref-diff-col pre code { font-family: inherit; font-size: inherit; }
.ref-diff-col.current .ref-diff-label { color: var(--color-critical); }
.ref-diff-col.current pre { background: rgba(239, 83, 80, 0.1); border: 1px solid rgba(239, 83, 80, 0.25); }
.ref-diff-col.suggested .ref-diff-label { color: var(--color-complete); }
.ref-diff-col.suggested pre { background: rgba(102, 187, 106, 0.1); border: 1px solid rgba(102, 187, 106, 0.25); }

.ref-code-only pre { margin: 0.5rem 0 0; padding: 0.5rem 0.75rem; background: var(--bg-secondary); border-radius: 4px; font-size: 0.75rem; font-family: var(--font-mono); white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
.ref-code-only pre code { font-family: inherit; font-size: inherit; }

.ref-suggested-only { margin-top: 0.5rem; }
.suggested-label { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-complete); margin-bottom: 0.2rem; }
.ref-suggested-only pre { margin: 0; padding: 0.5rem 0.75rem; background: rgba(102, 187, 106, 0.1); border: 1px solid rgba(102, 187, 106, 0.25); border-radius: 4px; font-size: 0.75rem; font-family: var(--font-mono); white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
.ref-suggested-only pre code { font-family: inherit; font-size: inherit; }
</style>
