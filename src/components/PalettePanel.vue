<script setup lang="ts">
import type { PaletteChoice } from '@/composables/usePaletteEditor'
import { Icon } from '@iconify/vue'
import { nextTick, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePaletteEditor } from '@/composables/usePaletteEditor'
import { PALETTE_PRESET_VALUES } from '@/utils/paletteColors'

const {
  app,
  group,
  field,
  fields,
  draft,
  selectedPreset,
  selectedKey,
  selectedInput,
  pickerColor,
  jsonText,
  jsonDirty,
  jsonError,
  status,
  busy,
  pendingConfirmation,
  invalid,
  ready,
  dirty,
  setPreset,
  updateInput,
  normalizeInput,
  importJson,
  copyJson,
  cancel,
  reloadSite,
  saveSite,
} = usePaletteEditor()
const heading = ref<HTMLElement | null>(null)
const inputKinds = ['hex', 'rgb', 'alpha'] as const
onMounted(() => heading.value?.focus({ preventScroll: true }))
// Disabling the focused Save control can send focus to body in Chromium.
// Keep Escape usable while loading/saving, without stealing another control's focus.
watch(busy, async () => {
  await nextTick()
  if (app.paletteOpen && document.activeElement === document.body)
    heading.value?.focus({ preventScroll: true })
})

function moveField(event: KeyboardEvent) {
  const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0
  if (!direction && event.key !== 'Home' && event.key !== 'End')
    return
  event.preventDefault()
  const index = fields.value.findIndex(item => item.key === field.value)
  const target = event.key === 'Home' ? 0 : event.key === 'End' ? fields.value.length - 1 : (index + direction + fields.value.length) % fields.value.length
  field.value = fields.value[target]!.key
  const buttons = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]')
  buttons[target]?.focus()
}
</script>

<template>
  <section id="palette-center" class="palette-panel" :data-mode="app.resolvedThemeMode" aria-labelledby="palette-heading" data-testid="palette-panel" @keydown.esc.stop.prevent="cancel">
    <div class="palette-top">
      <div>
        <h2 id="palette-heading" ref="heading" tabindex="-1">
          配色中心
        </h2>
        <p>编辑全站配色，保存前仅预览；关闭会放弃未保存修改。</p>
      </div>
      <Button variant="ghost" size="icon" aria-label="关闭配色中心并取消草稿" @click="cancel">
        <Icon icon="lucide:x" />
      </Button>
    </div>
    <fieldset :disabled="busy || !ready" class="palette-editing">
      <legend class="sr-only">
        编辑配色草稿
      </legend>
      <label class="palette-select">配色方案
        <select :value="selectedPreset" data-testid="palette-preset" @change="setPreset(($event.target as HTMLSelectElement).value as PaletteChoice)">
          <option v-for="(label, preset) in PALETTE_PRESET_VALUES" :key="preset" :value="preset">{{ label }}</option>
        </select>
      </label>
      <div class="palette-groups" role="group" aria-label="正在编辑的色组，不改变页面模式">
        <Button variant="outline" :aria-pressed="group === 'light'" @click="group = 'light'">
          编辑浅色
        </Button>
        <Button variant="outline" :aria-pressed="group === 'dark'" @click="group = 'dark'">
          编辑深色
        </Button>
        <span>页面当前为{{ app.resolvedThemeMode === 'dark' ? '深色' : '浅色' }}；编辑色组不会切换模式。</span>
      </div>
      <div class="palette-fields" role="radiogroup" aria-label="配色项目" @keydown="moveField">
        <Button v-for="item in fields" :key="item.key" type="button" variant="outline" role="radio" :aria-checked="field === item.key" :tabindex="field === item.key ? 0 : -1" :data-testid="`palette-field-${item.key}`" @click="field = item.key">
          <span class="palette-swatch" aria-hidden="true" :style="{ backgroundColor: draft.colors[`${group}${item.key}`] }" />
          {{ item.label }}
        </Button>
      </div>
      <div class="palette-inputs">
        <label>色盘<input type="color" :value="pickerColor" aria-label="色盘（保留透明度）" data-testid="palette-picker" @input="updateInput('hex', ($event.target as HTMLInputElement).value)"></label>
        <label v-for="kind in inputKinds" :key="kind" :for="`palette-${kind}`">
          {{ kind === 'alpha' ? '透明度 %' : kind.toUpperCase() }}
          <Input :id="`palette-${kind}`" :model-value="selectedInput[kind]" :inputmode="kind === 'alpha' ? 'decimal' : 'text'" :aria-invalid="Boolean(selectedInput.errors[kind])" :aria-describedby="selectedInput.errors[kind] ? `palette-${kind}-error` : undefined" spellcheck="false" autocomplete="off" @update:model-value="updateInput(kind, String($event))" @blur="normalizeInput(kind)" />
          <span v-if="selectedInput.errors[kind]" :id="`palette-${kind}-error`" class="palette-error" role="alert">{{ selectedInput.errors[kind] }}</span>
        </label>
      </div>
      <p class="palette-hint">
        {{ selectedKey }}：{{ draft.colors[selectedKey] }}。六位 HEX／RGB／色盘保留透明度；八位 HEX 可直接指定透明度。
      </p>
      <details class="palette-advanced">
        <summary>高级：十键 JSON 导入／导出</summary>
        <label for="palette-json">仅处理配色，不包含后台设置。导入为原子操作，非法内容不会部分生效。</label>
        <textarea id="palette-json" :value="jsonText" rows="8" spellcheck="false" :aria-invalid="Boolean(jsonError)" @input="jsonText = ($event.target as HTMLTextAreaElement).value; jsonDirty = true; jsonError = ''" />
        <p v-if="jsonError" class="palette-error" role="alert">
          {{ jsonError }}
        </p>
        <p v-else-if="jsonDirty">
          文本尚未导入；请导入或重新选择配色方案。
        </p>
        <div class="palette-actions">
          <Button variant="outline" @click="importJson">
            导入到草稿
          </Button>
          <Button variant="outline" :disabled="invalid" @click="copyJson">
            复制当前十键配色
          </Button>
          <Button variant="outline" :disabled="busy" @click="reloadSite">
            重新读取站点配色
          </Button>
        </div>
      </details>
    </fieldset>
    <p v-if="invalid" class="palette-error" role="alert">
      输入尚未完成。请修正、重新选择方案或取消，暂不能保存。
    </p>
    <p v-if="status" role="status" data-testid="palette-status">
      {{ status }}
    </p>
    <p v-if="busy" role="status">
      正在验证或保存，请稍候。关闭不会撤回已经发送的保存请求。
    </p>
    <div class="palette-actions palette-footer">
      <Button variant="outline" @click="cancel">
        取消
      </Button>
      <Button :disabled="!ready || !dirty || invalid || busy || pendingConfirmation" data-testid="palette-save-site" @click="saveSite">
        保存
      </Button>
    </div>
  </section>
</template>

<style scoped>
.palette-panel {
  --editor-bg: #fafafa;
  --editor-surface: #f4f4f5;
  --editor-text: #18181b;
  --editor-muted: #52525b;
  --editor-border: #d4d4d8;
  --editor-error: #a62936;
  --editor-focus: #246bce;
  position: relative;
  z-index: 2;
  margin: 12px 16px 20px;
  padding: 16px;
  border: 1px solid var(--editor-border);
  border-radius: 12px;
  background: var(--editor-bg);
  color: var(--editor-text);
  font-size: 14px;
  line-height: 1.5;
  color-scheme: light;
}
.palette-panel[data-mode='dark'] {
  --editor-bg: #18181b;
  --editor-surface: #27272a;
  --editor-text: #fafafa;
  --editor-muted: #a1a1aa;
  --editor-border: #52525b;
  --editor-error: #ffb3bb;
  --editor-focus: #8bb8ff;
  color-scheme: dark;
}
.palette-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.palette-top > button {
  align-self: flex-start;
}
.palette-top h2 {
  color: var(--editor-text);
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}
.palette-panel p {
  margin: 8px 0;
}
.palette-top p,
.palette-hint,
.palette-groups span {
  color: var(--editor-muted);
}
.palette-panel fieldset {
  min-width: 0;
  border: 0;
  padding: 0;
  margin: 14px 0;
}
.palette-actions,
.palette-fields,
.palette-groups {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.palette-panel :deep([data-slot='button']) {
  background: var(--editor-surface) !important;
  color: var(--editor-text) !important;
  border: 1px solid transparent !important;
  border-radius: 6px;
  white-space: normal;
  height: auto;
  min-height: 36px;
}
.palette-panel :deep([aria-pressed='true']),
.palette-panel :deep([aria-checked='true']),
.palette-panel :deep([data-variant='default']) {
  border-color: var(--editor-focus) !important;
}
.palette-fields :deep(button) {
  white-space: nowrap;
  gap: 6px;
  padding: 5px 9px;
}
.palette-swatch {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  border: 1px solid var(--editor-muted);
  border-radius: 50%;
}
.palette-panel :deep(:focus-visible) {
  outline: 2px solid var(--editor-focus);
  outline-offset: 3px;
}
.palette-panel :deep(button:disabled) {
  opacity: 1;
  color: var(--editor-muted) !important;
  border-style: dashed !important;
}
.palette-select {
  display: grid;
  gap: 6px;
  max-width: 300px;
  margin-top: 12px;
}
.palette-panel select,
.palette-panel textarea,
.palette-panel :deep([data-slot='input']) {
  background: var(--editor-bg) !important;
  color: var(--editor-text) !important;
  border: 1px solid var(--editor-border) !important;
  border-radius: 6px;
  font-size: 16px;
  padding: 8px;
}
.palette-panel select {
  min-height: 38px;
}
.palette-inputs {
  display: grid;
  grid-template-columns: 70px minmax(140px, 1fr) minmax(170px, 1.3fr) minmax(100px, 0.6fr);
  gap: 12px;
  margin-top: 16px;
}
.palette-inputs label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.palette-inputs input[type='color'] {
  width: 64px;
  height: 36px;
  cursor: pointer;
}
.palette-error {
  color: var(--editor-error) !important;
}
.palette-advanced {
  margin-top: 16px;
}
.palette-advanced summary {
  cursor: pointer;
  margin-bottom: 10px;
}
.palette-advanced textarea {
  display: block;
  width: 100%;
  margin-top: 8px;
  font-family: monospace;
}
.palette-footer {
  border-top: 1px solid var(--editor-border);
  padding-top: 12px;
}
@media (max-width: 767px) {
  .palette-inputs {
    grid-template-columns: 1fr 1fr;
  }
  .palette-panel {
    padding: 14px;
  }
}
@media (max-width: 359px) {
  .palette-inputs {
    grid-template-columns: 1fr;
  }
  .palette-panel {
    margin-inline: 10px;
    padding: 12px;
  }
}
</style>
