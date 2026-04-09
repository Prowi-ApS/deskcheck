<script setup lang="ts">
defineProps<{
  bg: string
  color: string
  border: string
}>()
</script>

<template>
  <span
    class="badge"
    :style="{ background: bg, color, borderColor: border }"
  >
    <slot />
  </span>
</template>

<style scoped>
.badge {
  display: inline-block;
  border: 1px solid;
  border-radius: 3px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 600;
  font-family: var(--font-sans);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  white-space: nowrap;
  line-height: 1.4;
}
</style>
