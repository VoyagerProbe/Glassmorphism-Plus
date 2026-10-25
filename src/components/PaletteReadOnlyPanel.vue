<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { nextTick, onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'
import { PALETTE_PRESET_VALUES } from '@/utils/paletteColors'

// Public, normalized colors only. Do not initialize the administrator editor,
// create a draft, or request any settings/permission endpoint from this view.
const app = useAppStore()
const heading = ref<HTMLElement | null>(null)
const groups = ['light', 'dark'] as const
const fields = { Card: '卡片', Control: '控制区', Text: '主文字', MutedText: '次文字', Border: '边框' } as const
onMounted(() => heading.value?.focus({ preventScroll: true }))

function close() {
  app.closePaletteEditor()
  void nextTick(() => document.querySelector<HTMLButtonElement>('[data-testid="palette-entry"]')?.focus())
}
</script>

<template>
  <section id="palette-center" class="palette-readonly" :data-mode="app.resolvedThemeMode" data-access="readonly" data-testid="palette-panel" aria-labelledby="palette-heading" @keydown.esc.stop.prevent="close">
    <div class="palette-readonly-top">
      <div>
        <h2 id="palette-heading" ref="heading" tabindex="-1">
          配色中心
        </h2>
        <p>当前为只读模式。登录管理员后可修改全站默认配色。</p>
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label="关闭配色中心" @click="close">
        <Icon icon="lucide:x" />
      </Button>
    </div>
    <p v-if="app.paletteAccessStatus" role="status">
      {{ app.paletteAccessStatus }}
    </p>
    <p data-testid="palette-readonly-preset">
      当前站点配色：{{ PALETTE_PRESET_VALUES[app.managedPalette.preset] }}
    </p>
    <div class="palette-readonly-groups" data-testid="palette-readonly">
      <section v-for="group in groups" :key="group" :aria-label="group === 'light' ? '浅色配色' : '深色配色'">
        <h3>{{ group === 'light' ? '浅色' : '深色' }}</h3>
        <dl>
          <div v-for="(label, key) in fields" :key="key" class="palette-readonly-color">
            <dt>{{ label }}</dt>
            <dd :data-testid="`palette-readonly-${group}${key}`">
              <span class="palette-readonly-swatch" aria-hidden="true" :style="{ backgroundColor: app.managedPalette.colors[`${group}${key}`] }" />
              <code>{{ app.managedPalette.colors[`${group}${key}`] }}</code>
            </dd>
          </div>
        </dl>
      </section>
    </div>
    <Button type="button" variant="outline" @click="close">
      关闭
    </Button>
  </section>
</template>

<style scoped>
.palette-readonly {
  --readonly-bg: #fafafa;
  --readonly-text: #18181b;
  --readonly-muted: #52525b;
  --readonly-border: #d4d4d8;
  position: relative;
  z-index: 2;
  margin: 12px 16px 20px;
  padding: 16px;
  border: 1px solid var(--readonly-border);
  border-radius: 12px;
  background: var(--readonly-bg);
  color: var(--readonly-text);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.palette-readonly[data-mode='dark'] {
  --readonly-bg: #18181b;
  --readonly-text: #fafafa;
  --readonly-muted: #a1a1aa;
  --readonly-border: #52525b;
}
.palette-readonly-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.palette-readonly-top > button {
  flex-shrink: 0;
}
.palette-readonly h2 {
  font-size: 18px;
  font-weight: 600;
}
.palette-readonly p {
  margin: 8px 0;
  color: var(--readonly-muted);
}
.palette-readonly-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 16px 0;
}
.palette-readonly h3 {
  font-weight: 600;
}
.palette-readonly-color,
.palette-readonly-color dd {
  display: flex;
  align-items: center;
  gap: 8px;
}
.palette-readonly-color {
  justify-content: space-between;
  margin-top: 8px;
}
.palette-readonly-swatch {
  flex: 0 0 14px;
  height: 14px;
  border: 1px solid var(--readonly-border);
  border-radius: 50%;
}
.palette-readonly :deep(button) {
  color: var(--readonly-text);
  background: var(--readonly-bg);
  border-color: var(--readonly-border);
}
@media (max-width: 767px) {
  .palette-readonly-groups {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
