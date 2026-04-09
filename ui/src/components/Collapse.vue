<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  title: string
  open?: boolean
}>()

const isOpen = ref(props.open ?? false)
</script>

<template>
  <div class="collapse">
    <button class="header" @click="isOpen = !isOpen">
      {{ isOpen ? '▾' : '▸' }} {{ title }}
    </button>
    <div v-if="isOpen" class="body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.collapse {
  margin-bottom: 12px;
}
.header {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  display: block;
  margin-bottom: 6px;
}
.header:hover {
  color: var(--text);
}
.body {
  margin-top: 6px;
}
</style>
