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
  saveSite: saveSiteSafely,
} = usePaletteEditor()
const heading = ref<HTMLElement | null>(null)
const inputKinds = ['hex', 'rgb', 'alpha'] as const
onMounted(() => heading.value?.focus({ preventScroll: true }))
// Disabling Save (Chromium) or clicking JSON import (WebKit) can send focus to
// body. Keep Escape usable after a draft action, without stealing another control's focus.
watch([busy, draft], async () => {
  await nextTick()
  if (app.paletteOpen && document.activeElement === document.body)
    heading.value?.focus({ preventScroll: true })
})

function saveSite() {
  // The direct save disables its triggering control. Move focus first, while
  // handling that explicit action, so WebKit cannot strand Escape on body.
  heading.value?.focus({ preventScroll: true })
  void saveSiteSafely()
}

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
  <section id="palette-center" class="palette-panel gp-palette" :data-mode="app.resolvedThemeMode" aria-labelledby="palette-heading" data-testid="palette-panel" @keydown.esc.stop.prevent="cancel">
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
    <div class="palette-workspace">
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
          <label for="palette-json">仅处理配色，不包含后台设置。导入为原子操作，非法内容不会部分生效。导入后仅更新当前预览，点击保存后才会应用到全站。</label>
          <textarea id="palette-json" :value="jsonText" rows="8" spellcheck="false" :aria-invalid="Boolean(jsonError)" @input="jsonText = ($event.target as HTMLTextAreaElement).value; jsonDirty = true; jsonError = ''" />
          <p v-if="jsonError" class="palette-error" role="alert">
            {{ jsonError }}
          </p>
          <p v-else-if="jsonDirty">
            文本尚未导入；请导入或重新选择配色方案。
          </p>
          <div class="palette-actions">
            <Button variant="outline" @click="importJson">
              导入
            </Button>
            <Button variant="outline" :disabled="invalid" @click="copyJson">
              复制当前十键配色
            </Button>
          </div>
        </details>
      </fieldset>
      <aside
        class="palette-sample" aria-label="所编辑色组的实际配色预览" data-testid="palette-sample"
        :style="{ '--sample-card': draft.colors[`${group}Card`], '--sample-control': draft.colors[`${group}Control`], '--sample-text': draft.colors[`${group}Text`], '--sample-muted': draft.colors[`${group}MutedText`], '--sample-border': draft.colors[`${group}Border`] }"
      >
        <span class="palette-sample-meta">{{ group === 'light' ? '浅色' : '深色' }}色组 · 草稿预览</span>
        <strong>站点配色预览</strong>
        <div class="palette-sample-control">
          控制区表面
        </div>
        <p class="palette-sample-meta">
          此处使用所编辑的五项颜色。编辑工具保持可读，方便取消或修正。
        </p>
      </aside>
    </div>
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

<style src="../styles/scheme2-palette.css"></style>
