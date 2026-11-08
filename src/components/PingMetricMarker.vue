<script setup lang="ts">
defineProps<{ metric: 'latency' | 'loss' }>()
</script>

<template>
  <span class="node-card-ping-trend-label" :data-node-ping-header="metric" aria-hidden="true">
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path v-if="metric === 'latency'" d="M1.5 8h3l1.8-5 3.1 10 1.8-5h3.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <g v-else fill="currentColor">
        <rect x="1.5" y="8" width="3" height="6" rx=".6" />
        <rect x="6.5" y="2" width="3" height="12" rx=".6" />
        <rect x="11.5" y="5" width="3" height="9" rx=".6" />
      </g>
    </svg>
  </span>
</template>
