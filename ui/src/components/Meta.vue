<script setup lang="ts">
export interface MetaItem {
  label: string
  /** Either a plain string value or rendered via the default slot. */
  value?: string | number
  /** Render value in mono font (for paths, refs, ids). */
  mono?: boolean
}

defineProps<{ items: MetaItem[] }>()
</script>

<template>
  <div class="meta">
    <div v-for="item in items" :key="item.label" class="cell">
      <div class="label">{{ item.label }}</div>
      <div class="value" :class="{ mono: item.mono }">
        <slot :name="item.label" :item="item">{{ item.value }}</slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.meta {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.label {
  font-size: 9px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.value {
  font-size: 12px;
  color: var(--text);
  font-weight: 500;
}
.value.mono {
  font-family: var(--font-mono);
}
</style>
