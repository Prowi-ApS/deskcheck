<script setup lang="ts">
defineProps<{
  status: string
}>()
</script>

<template>
  <span class="badge" :class="`badge-${status}`">{{ status }}</span>
</template>

<style scoped>
.badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.badge-planning {
  background: rgba(171, 71, 188, 0.2);
  color: var(--color-planning);
}

.badge-ready {
  background: rgba(79, 195, 247, 0.15);
  color: var(--color-ready);
}

.badge-executing {
  background: rgba(79, 195, 247, 0.15);
  color: var(--color-executing);
  animation: pulse-glow 2s ease-in-out infinite;
}

.badge-complete {
  background: rgba(102, 187, 106, 0.2);
  color: var(--color-complete);
}

.badge-error {
  background: rgba(239, 83, 80, 0.2);
  color: var(--color-error);
}

@keyframes pulse-glow {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}
</style>
