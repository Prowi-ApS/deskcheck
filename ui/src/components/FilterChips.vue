<script setup lang="ts" generic="T extends string">
export interface ChipOption<V extends string> {
  value: V
  label: string
  /** Optional active background override (e.g. severity colors). */
  activeBg?: string
  /** Optional active text/border color override. */
  activeColor?: string
}

const props = defineProps<{
  options: ChipOption<T>[]
  /** Single-select: T. Multi-select: T[]. */
  modelValue: T | T[]
  multi?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: T | T[]): void
}>()

function isActive(opt: ChipOption<T>): boolean {
  if (props.multi) {
    return Array.isArray(props.modelValue) && props.modelValue.includes(opt.value)
  }
  return props.modelValue === opt.value
}

function handleClick(opt: ChipOption<T>): void {
  if (props.multi) {
    const current = Array.isArray(props.modelValue) ? props.modelValue : []
    const next = current.includes(opt.value)
      ? current.filter((v) => v !== opt.value)
      : [...current, opt.value]
    emit('update:modelValue', next)
  } else {
    emit('update:modelValue', opt.value)
  }
}
</script>

<template>
  <div class="chips">
    <button
      v-for="opt in options"
      :key="opt.value"
      class="chip"
      :class="{ active: isActive(opt) }"
      :style="
        isActive(opt)
          ? {
              background: opt.activeBg ?? 'var(--accent-soft)',
              color: opt.activeColor ?? 'var(--accent)',
              borderColor: (opt.activeColor ?? 'var(--accent)') + '4d',
            }
          : undefined
      "
      @click="handleClick(opt)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  gap: 5px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.chip {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 3px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.chip:hover {
  color: var(--text);
}
</style>
