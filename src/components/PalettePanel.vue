<script setup lang="ts">
import type { GlassColorPreset } from '@/utils/paletteColors'
import { Icon } from '@iconify/vue'
import { onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePaletteEditor } from '@/composables/usePaletteEditor'
import { PALETTE_PRESET_VALUES } from '@/utils/paletteColors'

const {
  app,
  group,
  field,
  fields,
  scope,
  draft,
  selectedKey,
  selectedInput,
  pickerColor,
  jsonText,
  jsonDirty,
  jsonError,
  status,
  busy,
  pendingConfirmation,
  confirmation,
  invalid,
  setPreset,
  updateInput,
  normalizeInput,
  resetGroup,
  resetAll,
  importJson,
  copyJson,
  cancel,
  applyLocal,
  followSite,
  loadSite,
  editLocal,
  copyLocalToSite,
  saveSite,
} = usePaletteEditor()
const heading = ref<HTMLElement | null>(null)
const inputKinds = ['hex', 'rgb', 'alpha'] as const
onMounted(() => heading.value?.focus({ preventScroll: true }))
</script>

<template>
  <section id="palette-center" class="palette-panel" :data-mode="app.resolvedThemeMode" aria-labelledby="palette-heading" data-testid="palette-panel" @keydown.esc.stop.prevent="cancel">
    <div class="palette-top">
      <div>
        <h2 id="palette-heading" ref="heading" tabindex="-1">
          配色中心
        </h2>
        <p>即时预览 · {{ scope === 'local' ? '仅此浏览器' : '全站默认草稿' }} · 关闭即放弃未保存草稿</p>
      </div>
      <Button variant="ghost" size="icon" aria-label="关闭配色中心并取消草稿" @click="cancel">
        <Icon icon="lucide:x" />
      </Button>
    </div>
    <div class="palette-actions" aria-label="配色作用范围">
      <Button variant="outline" :aria-pressed="scope === 'local'" :disabled="busy" @click="editLocal">
        本机配色
      </Button>
      <Button v-if="app.privateFeaturesAllowed" variant="outline" :disabled="busy" @click="loadSite">
        {{ scope === 'site' ? '重新读取站点配色' : '验证权限并编辑全站配色' }}
      </Button>
      <span v-else>全站默认仅可由已验证的管理员修改。</span>
    </div>
    <p v-if="scope === 'site'" class="palette-hint">
      此草稿从最新站点设置读取。保存只修改配色字段；其他窗口同时保存仍可能冲突，请避免并行编辑。
      <Button v-if="app.appliedLocalPalette" variant="outline" size="sm" :disabled="busy" @click="copyLocalToSite">
        将本机配色复制到全站草稿
      </Button>
    </p>
    <fieldset :disabled="busy" class="palette-editing">
      <legend class="sr-only">
        编辑配色草稿
      </legend>
      <label class="palette-preset">配色方案
        <select :value="draft.preset" data-testid="palette-preset" @change="setPreset(($event.target as HTMLSelectElement).value as GlassColorPreset)">
          <option v-for="(label, preset) in PALETTE_PRESET_VALUES" :key="preset" :value="preset">{{ preset === 'softFrost' ? '原版柔雾' : label }}</option>
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
      <div class="palette-colors" role="group" aria-label="选择色项">
        <Button v-for="item in fields" :key="item.key" variant="outline" :aria-pressed="field === item.key" :data-testid="`palette-field-${item.key}`" @click="field = item.key">
          <span class="palette-swatch" :style="{ backgroundColor: draft.colors[`${group}${item.key}`] }" aria-hidden="true" />{{ item.label }}
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
      <div class="palette-actions">
        <Button variant="outline" @click="resetGroup">
          恢复本色组为柔雾
        </Button>
        <Button variant="outline" @click="resetAll">
          恢复全部柔雾预设
        </Button>
      </div>
      <details class="palette-advanced">
        <summary>高级：十键 JSON 导入／导出</summary>
        <label for="palette-json">仅处理配色，不包含后台设置。导入为原子操作，非法内容不会部分生效。</label>
        <textarea id="palette-json" :value="jsonText" rows="8" spellcheck="false" :aria-invalid="Boolean(jsonError)" @input="jsonText = ($event.target as HTMLTextAreaElement).value; jsonDirty = true; jsonError = ''; confirmation = false" />
        <p v-if="jsonError" class="palette-error" role="alert">
          {{ jsonError }}
        </p>
        <p v-else-if="jsonDirty">
          文本尚未导入；应用前请导入或恢复草稿。
        </p>
        <div class="palette-actions">
          <Button variant="outline" @click="importJson">
            导入到草稿
          </Button>
          <Button variant="outline" :disabled="invalid" @click="copyJson">
            复制当前十键配色
          </Button>
        </div>
      </details>
    </fieldset>
    <p v-if="invalid" class="palette-error" role="alert">
      存在无效或尚未导入的输入。请修正、恢复或取消，暂不能应用。
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
      <template v-if="scope === 'local'">
        <Button variant="outline" :disabled="busy" @click="followSite">
          跟随站点配色
        </Button>
        <Button :disabled="invalid || busy" data-testid="palette-apply-local" @click="applyLocal">
          套用到此浏览器
        </Button>
      </template>
      <template v-else>
        <label class="palette-confirm"><input v-model="confirmation" type="checkbox" :disabled="invalid || busy || pendingConfirmation">确认设为全站默认</label>
        <Button :disabled="invalid || busy || pendingConfirmation || !confirmation" data-testid="palette-save-site" @click="saveSite">
          保存全站默认
        </Button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.palette-panel {
  --editor-bg: #f8fafc;
  --editor-surface: #e8edf4;
  --editor-text: #111111;
  --editor-muted: #4f5d70;
  --editor-border: #6f7c90;
  --editor-error: #a62936;
  --editor-focus: #246bce;
  position: relative;
  z-index: 2;
  margin: 12px 16px 20px;
  padding: 18px;
  border: 1px solid var(--editor-border);
  border-radius: 18px;
  background: var(--editor-bg);
  color: var(--editor-text);
  font-size: 14px;
  line-height: 1.5;
  color-scheme: light;
}
.palette-panel[data-mode='dark'] {
  --editor-bg: #1e2732;
  --editor-surface: #2c3744;
  --editor-text: #f2f5fa;
  --editor-muted: #b2bfd1;
  --editor-border: #9aa9bd;
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
.palette-groups,
.palette-colors {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.palette-panel :deep([data-slot='button']) {
  background: var(--editor-surface) !important;
  color: var(--editor-text) !important;
  border: 1px solid var(--editor-border) !important;
  border-radius: 12px;
  white-space: normal;
  height: auto;
  min-height: 36px;
}
.palette-panel :deep([aria-pressed='true']),
.palette-panel :deep([data-variant='default']) {
  box-shadow: inset 0 0 0 2px var(--editor-focus);
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
.palette-preset {
  display: grid;
  gap: 6px;
  max-width: 300px;
}
.palette-panel select,
.palette-panel textarea,
.palette-panel :deep([data-slot='input']) {
  background: var(--editor-bg) !important;
  color: var(--editor-text) !important;
  border: 1px solid var(--editor-border) !important;
  border-radius: 10px;
  font-size: 16px;
  padding: 8px;
}
.palette-panel select {
  min-height: 38px;
}
.palette-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--editor-border);
  flex: 0 0 auto;
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
.palette-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
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
