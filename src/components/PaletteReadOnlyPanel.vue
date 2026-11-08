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
  <section id="palette-center" class="palette-readonly gp-palette" :data-mode="app.resolvedThemeMode" data-access="readonly" data-testid="palette-panel" aria-labelledby="palette-heading" @keydown.esc.stop.prevent="close">
    <div class="palette-top">
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

<style src="../styles/scheme2-palette.css"></style>
