<script setup lang="ts">
export interface Tab {
  key: string
  label: string
  count?: number
}

defineProps<{
  tabs: Tab[]
  activeTab: string
}>()

const emit = defineEmits<{
  'update:activeTab': [key: string]
}>()
</script>

<template>
  <div class="tab-bar">
    <div class="tab-bar-inner">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="emit('update:activeTab', tab.key)"
      >
        {{ tab.label }}
        <span v-if="tab.count != null" class="tab-count">{{ tab.count }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tab-bar { border-bottom: 1px solid var(--border); padding: 0 2rem; }
.tab-bar-inner { max-width: 1100px; margin: 0 auto; display: flex; gap: 0; }
.tab-btn { position: relative; padding: 0.6rem 1rem; border: none; background: none; color: var(--text-muted); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; transition: color 0.15s; }
.tab-btn:hover { color: var(--text-secondary); }
.tab-btn.active { color: var(--accent); }
.tab-btn.active::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: var(--accent); }
.tab-count { font-family: var(--font-mono); font-size: 0.65rem; background: var(--bg-card); padding: 0.1rem 0.35rem; border-radius: 3px; margin-left: 0.3rem; }
.tab-btn.active .tab-count { background: rgba(79, 195, 247, 0.15); color: var(--accent); }
</style>
