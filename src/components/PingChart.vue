<script setup lang="ts">
import type { ChartTuple } from '@/utils/pingChartProjection'
import type { PingTimeWindow } from '@/utils/pingTime'
import type { MetricSeries, PingMetricTaskStats, PingRecord, PingTaskInfo } from '@/utils/rpc'
import { Icon } from '@iconify/vue'
import dayjs from 'dayjs'
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useChartTheme } from '@/composables/useChartTheme'
import { usePingTooltipTouch } from '@/composables/usePingTooltipTouch'
import { CACHE_CONFIG } from '@/constants/cache'
import { PING_RECORD_MAX_COUNT } from '@/constants/load'
import { getAuthSessionRevision } from '@/services/auth.service'
import { loadPingRecordsWithTasks } from '@/services/history.service'
import { loadPingMetricStats, loadPublicPingTasks } from '@/services/metrics.service'
import { readChartMetricWindow, restoreMissingChartRows } from '@/services/pingChartTail.service'
import { loadPingMetricCoverage } from '@/services/pingMetricCoverage.service'
import { useAppStore } from '@/stores/app'
import { ACCESSIBLE_LINE_TYPES, getChartSeriesPalette } from '@/utils/chartPalette'
import { PING_LATENCY_METRIC, PING_LOSS_METRIC } from '@/utils/metricSeries'
import { assignedChartTasks, currentPingId, pingReadDenied } from '@/utils/pingChartDirectory'
import { resolvePingChartDisplayDomain } from '@/utils/pingChartDisplayDomain'
import { escapePingTooltip, pingChartTaskLabels, pingLossPercent, pingTooltipLoss } from '@/utils/pingChartPresentation'
import { chartMetricSamples, chartSymbols } from '@/utils/pingChartProjection'
import { smoothPingChartDisplayRows } from '@/utils/pingChartSmoothing'
import { mergePingMetricCoverageResponses } from '@/utils/pingMetricCoverage'
import { createNextAlignedPingTimeWindow, createPingTimeWindow, isPingTimestampInWindow, parsePingTimestampMs } from '@/utils/pingTime'
import { RpcError } from '@/utils/rpc'
import '@/utils/echarts' // 共享 ECharts 配置

const props = defineProps<{
  uuid: string
  lossHistory?: boolean
}>()

const appStore = useAppStore()

interface CustomRange {
  start: dayjs.Dayjs
  end: dayjs.Dayjs
  hours: number
}

interface PingChartTaskInfo extends PingTaskInfo {
  /** A Metric latency series can be useful before the optional loss summary arrives. */
  lossAvailable?: boolean
}

interface PingChartRecord extends PingRecord {
  /** Presentation-only marker: false for a backend fill-empty layout point. */
  finalized: boolean
  /** Paired Metric ratio, never a task summary or inferred Legacy loss. */
  lossRatio?: number | null
}

// 图表主题相关颜色
const chartThemeColors = useChartTheme()

const chartColors = reactive(getChartSeriesPalette(appStore.colorVisionFriendly))

watchEffect(() => {
  chartColors.splice(0, chartColors.length, ...getChartSeriesPalette(appStore.colorVisionFriendly))
})

// 从 publicSettings 获取记录保留时间
const maxPingRecordPreserveTime = computed(() => appStore.publicSettings?.ping_record_preserve_time || 168)

// 视图选项
const presetViews = [
  { label: '1 小时', hours: 1 },
  { label: '6 小时', hours: 6 },
  { label: '12 小时', hours: 12 },
  { label: '1 天', hours: 24 },
  { label: '7 天', hours: 168 },
  { label: '14 天', hours: 336 },
  { label: '30 天', hours: 720 },
]
const CUSTOM_VIEW_LABEL = '自定义'
const DEFAULT_CUSTOM_RANGE_HOURS = 24
const HISTORY_BUCKET_COUNT = CACHE_CONFIG.nodePingSummary.historyBucketCount

// 可用视图列表
const availableViews = computed(() => {
  const views: { label: string, hours?: number }[] = []
  const maxHours = maxPingRecordPreserveTime.value

  for (const v of presetViews) {
    if (maxHours >= v.hours) {
      views.push(v)
    }
  }

  const maxPreset = presetViews.at(-1)
  if (maxPreset && maxHours > maxPreset.hours) {
    const label = maxHours % 24 === 0
      ? `${Math.floor(maxHours / 24)} 天`
      : `${maxHours} 小时`
    views.push({ label, hours: maxHours })
  }
  else if (maxHours > 1 && !presetViews.some(v => v.hours === maxHours)) {
    const label = maxHours % 24 === 0
      ? `${Math.floor(maxHours / 24)} 天`
      : `${maxHours} 小时`
    views.push({ label, hours: maxHours })
  }

  views.push({ label: CUSTOM_VIEW_LABEL })
  return views
})

// 当前选中的视图
const selectedView = ref<string>('')
const customStartInput = ref('')
const customEndInput = ref('')
const appliedCustomRange = shallowRef<CustomRange | null>(null)
const isCustomRange = computed(() => selectedView.value === CUSTOM_VIEW_LABEL)
const customRange = computed<CustomRange | null>(() => {
  if (!customStartInput.value || !customEndInput.value)
    return null

  const start = dayjs(customStartInput.value)
  const end = dayjs(customEndInput.value)
  if (!start.isValid() || !end.isValid() || !end.isAfter(start))
    return null

  return {
    start,
    end,
    hours: Math.max(1, Math.ceil(end.diff(start, 'hour', true))),
  }
})
const customRangeError = computed(() => {
  if (!isCustomRange.value || (!customStartInput.value && !customEndInput.value))
    return ''
  if (!customStartInput.value || !customEndInput.value)
    return '请选择开始和结束时间'
  return customRange.value ? '' : '结束时间必须晚于开始时间'
})
const selectedHours = computed(() => {
  if (isCustomRange.value)
    return appliedCustomRange.value?.hours ?? customRange.value?.hours ?? DEFAULT_CUSTOM_RANGE_HOURS

  const view = availableViews.value.find(v => v.label === selectedView.value)
  return view?.hours || 1
})

function ensureDefaultCustomRange() {
  if (customStartInput.value && customEndInput.value)
    return

  const end = dayjs()
  const hours = Math.max(1, Math.min(DEFAULT_CUSTOM_RANGE_HOURS, maxPingRecordPreserveTime.value))
  customStartInput.value = end.subtract(hours, 'hour').format('YYYY-MM-DDTHH:mm')
  customEndInput.value = end.format('YYYY-MM-DDTHH:mm')
}

// 初始化默认视图
watch(availableViews, (views) => {
  const firstView = views[0]
  if (firstView && !selectedView.value) {
    selectedView.value = firstView.label
  }
}, { immediate: true })

// ==================== 数据状态 ====================
const remoteData = shallowRef<PingChartRecord[]>([])
const tasks = shallowRef<PingChartTaskInfo[]>([])
const activeTimeWindow = shallowRef<PingTimeWindow | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const legacyCustomRangeFallback = ref(false)

// 任务选择
const selectedTaskIds = ref<number[]>([])
// Local UI state: reconcile only accepted task inventories, not range/loading resets.
let selectionAvailableTaskIds: number[] | null = null
let followAllTasks = true
const isTouchTooltipMode = ref(false)
const activeTaskTooltipId = ref<number | null>(null)
const smoothPeaks = ref(false)
const showLoss = ref(true)
const dualChart = computed(() => props.lossHistory === true && showLoss.value)
const chart = shallowRef<InstanceType<typeof VChart> | null>(null)
const chartHost = shallowRef<HTMLElement | null>(null)
const { reset: resetTooltipTouch } = usePingTooltipTouch(chartHost, dualChart, clearChartHover)

function clearChartHover() {
  resetTooltipTouch()
  chart.value?.dispatchAction({ type: 'hideTip' })
  chart.value?.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' })
}
const smoothInfoTooltipOpen = ref(false)
const hiddenInLegend = shallowRef(new Set<number>())

const chartMargin = { top: 30, right: 24, bottom: 52, left: 56 }
let coarsePointerMediaQuery: MediaQueryList | null = null
let fetchRecordsSequence = 0

function syncTouchTooltipMode() {
  if (typeof window === 'undefined') {
    isTouchTooltipMode.value = false
    return
  }

  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches
  const hasTouchPoints = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
  isTouchTooltipMode.value = hasCoarsePointer || hasTouchPoints
}

function setTaskTooltipOpen(taskId: number, open: boolean) {
  activeTaskTooltipId.value = open ? taskId : activeTaskTooltipId.value === taskId ? null : activeTaskTooltipId.value
}

function toggleTaskTooltip(taskId: number) {
  if (!isTouchTooltipMode.value)
    return

  smoothInfoTooltipOpen.value = false
  activeTaskTooltipId.value = activeTaskTooltipId.value === taskId ? null : taskId
}

function setSmoothInfoTooltipOpen(open: boolean) {
  smoothInfoTooltipOpen.value = open
}

function toggleSmoothInfoTooltip() {
  if (!isTouchTooltipMode.value)
    return

  activeTaskTooltipId.value = null
  smoothInfoTooltipOpen.value = !smoothInfoTooltipOpen.value
}

function normalizeMetricTask(stat: PingMetricTaskStats): PingChartTaskInfo {
  const lossAvailable = stat.total > 0 && Number.isFinite(stat.loss)
  return {
    id: currentPingId(stat.task_id),
    name: stat.name ?? '',
    interval: stat.interval ?? 0,
    // Keep the mandatory display field typed while explicitly marking an
    // unavailable summary. The raw latency records remain usable either way.
    loss: lossAvailable ? stat.loss : 0,
    lossAvailable,
    min: stat.min,
    max: stat.max,
    avg: typeof stat.avg === 'number' && Number.isFinite(stat.avg) ? stat.avg : undefined,
    latest: typeof stat.latest === 'number' && Number.isFinite(stat.latest) && stat.latest >= 0 && stat.valid !== 0 ? stat.latest : undefined,
    p50: stat.p50,
    p99: stat.p99,
    p99_p50_ratio: stat.p99_p50_ratio,
    stddev: stat.stddev,
    total: stat.total,
    valid: stat.valid,
    loss_approximate: stat.loss_approximate,
    type: stat.type,
  }
}

function buildMetricRecords(
  seriesList: MetricSeries[],
  nodeUuid: string,
  window: PingTimeWindow,
): { records: PingChartRecord[], hasObservedData: boolean } {
  const samples = chartMetricSamples(seriesList, nodeUuid, window)
  const records = samples.flatMap((sample) => {
    const taskId = currentPingId(sample.taskId)
    if (!Number.isFinite(taskId))
      return []

    return [{
      client: sample.entityId,
      task_id: taskId,
      time: sample.time,
      // Preserve a real full-loss/null bucket as an explicit chart gap.
      value: sample.latency ?? -1,
      finalized: sample.observed,
      lossRatio: sample.loss,
    }]
  })

  return {
    records,
    hasObservedData: samples.some(sample => sample.observed),
  }
}

function getPingChartTimeWindow(): PingTimeWindow | null {
  const range = appliedCustomRange.value
  if (isCustomRange.value && range) {
    return createPingTimeWindow(range.start.valueOf(), range.end.valueOf(), HISTORY_BUCKET_COUNT)
  }

  return createNextAlignedPingTimeWindow(Date.now(), selectedHours.value, HISTORY_BUCKET_COUNT)
}

async function loadChartWindow(
  nodeUuid: string,
  window: PingTimeWindow,
  legacyHours: number,
  custom: boolean,
  current: () => boolean,
) {
  const range = { start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() }
  const params = {
    entity_id: nodeUuid,
    metric_keys: [PING_LATENCY_METRIC, PING_LOSS_METRIC],
    ...range,
    downsample: true,
    fill_empty: true,
    max_points: PING_RECORD_MAX_COUNT,
    aggregation: 'avg',
  }
  let legacy: Awaited<ReturnType<typeof loadPingRecordsWithTasks>> | undefined
  const readLegacy = async () => legacy ??= await loadPingRecordsWithTasks(legacyHours, PING_RECORD_MAX_COUNT, nodeUuid)
  let directory: PingTaskInfo[]
  try {
    directory = assignedChartTasks(await loadPublicPingTasks(), nodeUuid)
  }
  catch (error) {
    // Old servers without this method may return their current, UUID-filtered
    // directory alongside records. A denial or partial directory is not empty.
    if (!(error instanceof RpcError) || error.code !== -32601 || !current())
      throw error
    const scoped = await readLegacy()
    if (!scoped.hasTaskDirectory)
      throw new Error('无法确认当前节点的 Ping 任务目录')
    directory = assignedChartTasks(scoped.tasks, nodeUuid, true)
  }
  const ids = new Set(directory.map(task => task.id))
  const empty = { records: [] as PingChartRecord[], tasks: [] as PingChartTaskInfo[], legacy: false }
  if (!current() || !ids.size)
    return empty
  let denied = false
  const [stats, coverage] = await Promise.allSettled([
    loadPingMetricStats({ entity_id: nodeUuid, ...range, max_points: PING_RECORD_MAX_COUNT }).catch((error: unknown) => {
      denied = pingReadDenied(error)
      throw error
    }),
    loadPingMetricCoverage(params, (query) => {
      if (!current() || denied)
        throw new Error('Ping 请求上下文已变更')
      return readChartMetricWindow(query, query.start === params.start ? 'window' : 'supplement')
    }),
  ])
  if (!current())
    return empty
  for (const result of [stats, coverage]) {
    if (result.status === 'rejected' && pingReadDenied(result.reason))
      throw result.reason
  }
  const summaries = new Map<number, PingChartTaskInfo>()
  if (stats.status === 'fulfilled') {
    for (const stat of stats.value.stats ?? []) {
      const id = currentPingId(stat.task_id)
      if (stat.entity_id?.toLowerCase() === nodeUuid.toLowerCase() && ids.has(id) && stat.total > 0)
        summaries.set(id, normalizeMetricTask(stat))
    }
  }
  let records = coverage.status === 'fulfilled'
    ? buildMetricRecords(coverage.value.response.series, nodeUuid, window).records.filter(record => ids.has(record.task_id))
    : []
  if (coverage.status === 'fulfilled') {
    records = await restoreMissingChartRows(records, ids, params, (response, start, end) => buildMetricRecords(mergePingMetricCoverageResponses([response]).series, nodeUuid, { ...window, start, end }).records, current)
  }
  const useLegacy = !records.some(record => record.finalized)
  if (useLegacy) {
    const scoped = await readLegacy()
    if (!current())
      return empty
    const byTime = new Map<string, PingChartRecord>()
    for (const record of scoped.records) {
      const time = parsePingTimestampMs(record.time)
      if (record.client.toLowerCase() !== nodeUuid.toLowerCase() || !ids.has(record.task_id)
        || time === null || !isPingTimestampInWindow(time, window) || !Number.isFinite(record.value)) {
        continue
      }
      const key = `${record.task_id}:${time}`
      const previous = byTime.get(key)
      if (!previous)
        byTime.set(key, { ...record, time: new Date(time).toISOString(), finalized: true })
      else if (previous.value !== record.value)
        previous.value = -1 // equally ranked, conflicting Legacy observations: unknown, not an inferred loss percentage
    }
    records = [...byTime.values()]
    const witnessed = new Set(records.map(r => r.task_id))
    for (const task of scoped.tasks) {
      if (!custom && !summaries.has(task.id) && ids.has(task.id) && ((task.total ?? 0) > 0 || (task.total === undefined && witnessed.has(task.id)))) {
        summaries.set(task.id, { ...task, latest: typeof task.latest === 'number' && task.latest >= 0 && task.valid !== 0 ? task.latest : undefined, lossAvailable: Number.isFinite(task.loss) })
      }
    }
  }
  const ordered = directory.map((task): PingChartTaskInfo => {
    const summary = summaries.get(task.id)
    return { ...summary, id: task.id, name: task.name, interval: task.interval ?? summary?.interval ?? 0, type: task.type ?? summary?.type, loss: summary?.loss ?? 0, lossAvailable: summary?.lossAvailable ?? false }
  })
  return { tasks: ordered, records, legacy: useLegacy }
}

// ==================== 数据获取 ====================

async function fetchRecords() {
  clearChartHover()
  const sequence = ++fetchRecordsSequence
  const requestedUuid = props.uuid
  const revision = getAuthSessionRevision()
  const current = () => sequence === fetchRecordsSequence && requestedUuid === props.uuid && revision === getAuthSessionRevision()
  if (!requestedUuid)
    return

  if (isCustomRange.value && !customRange.value) {
    remoteData.value = []
    tasks.value = []
    error.value = customRangeError.value || '请选择有效的自定义时间范围'
    legacyCustomRangeFallback.value = false
    loading.value = false
    return
  }

  appliedCustomRange.value = isCustomRange.value ? customRange.value : null
  const requestedWindow = getPingChartTimeWindow()
  if (!requestedWindow) {
    remoteData.value = []
    tasks.value = []
    error.value = '无法创建有效的时间范围'
    legacyCustomRangeFallback.value = false
    loading.value = false
    return
  }

  loading.value = true
  error.value = null

  try {
    const range = appliedCustomRange.value
    const legacyHours = range
      ? Math.min(
          maxPingRecordPreserveTime.value,
          Math.max(range.hours, Math.ceil(dayjs().diff(range.start, 'hour', true))),
        )
      : selectedHours.value
    const result = await loadChartWindow(requestedUuid, requestedWindow, legacyHours, isCustomRange.value, current)
    if (!current())
      return
    legacyCustomRangeFallback.value = result.legacy && isCustomRange.value
    activeTimeWindow.value = requestedWindow
    remoteData.value = result.records.sort((a, b) => (parsePingTimestampMs(a.time) ?? 0) - (parsePingTimestampMs(b.time) ?? 0))
    tasks.value = result.tasks

    const availableIds = tasks.value.map(t => t.id)
    if (selectionAvailableTaskIds === null || availableIds.join(',') !== selectionAvailableTaskIds.join(',')) {
      const retainedIds = selectedTaskIds.value.filter(id => availableIds.includes(id))
      selectedTaskIds.value = selectionAvailableTaskIds === null || followAllTasks
        ? availableIds
        : retainedIds
      selectionAvailableTaskIds = availableIds
    }
  }
  catch (err) {
    if (!current())
      return

    activeTimeWindow.value = requestedWindow
    error.value = err instanceof Error ? err.message : '获取数据失败'
    legacyCustomRangeFallback.value = false
    remoteData.value = []
    tasks.value = []
  }
  finally {
    if (sequence === fetchRecordsSequence)
      loading.value = false
  }
}

// ==================== 数据处理 ====================

const mergedData = computed(() => {
  const data = remoteData.value
  const window = activeTimeWindow.value
  if (!data.length || !window)
    return []

  const grouped: Map<number, Record<string, unknown>> = new Map()

  for (const rec of data) {
    const ts = parsePingTimestampMs(rec.time)
    if (ts === null || !isPingTimestampInWindow(ts, window))
      continue

    // Do not coalesce near-by samples. A task's exact source timestamp is
    // meaningful Ping data; combining a <=6s neighbour manufactures a shared
    // sampling instant that the backend never reported.
    if (!grouped.has(ts))
      grouped.set(ts, { time: rec.time })

    const group = grouped.get(ts)!
    group[rec.task_id] = rec.value < 0 ? null : rec.value
  }

  const merged = Array.from(grouped.values()).sort(
    (a, b) => (parsePingTimestampMs(a.time) ?? 0) - (parsePingTimestampMs(b.time) ?? 0),
  )
  return merged
})

const chartData = computed(() => {
  if (selectedTaskIds.value.length === 0)
    return []

  if (!smoothPeaks.value)
    return mergedData.value

  // Smoothing is display-only. It deliberately preserves raw timestamps and
  // gaps so missing/PENDING samples cannot become fabricated history.
  return smoothPingChartDisplayRows(mergedData.value, selectedTaskIds.value)
})

// ==================== 工具函数 ====================

function formatTime(time: string | number, showDate: boolean): string {
  const timestamp = parsePingTimestampMs(time)
  if (timestamp === null)
    return '-'

  const date = dayjs(timestamp)
  if (showDate) {
    return date.format('M/D HH:mm')
  }
  return date.format('HH:mm')
}

function formatTimeForTooltip(time: string | number, hours: number): string {
  const timestamp = parsePingTimestampMs(time)
  if (timestamp === null)
    return '-'

  const date = dayjs(timestamp)
  if (hours < 24) {
    return date.format('HH:mm:ss')
  }
  return date.format('MM/DD HH:mm')
}

const showDateInAxis = computed(() => selectedHours.value >= 24)

// ==================== 任务选择 ====================

// 获取任务颜色（根据任务在完整列表中的索引）
function getTaskColor(taskId: number): string {
  const taskIndex = tasks.value.findIndex(t => t.id === taskId)
  const safeIndex = Math.max(0, taskIndex % chartColors.length)
  return chartColors[safeIndex]!
}

// 最新值统计（从服务端 tasks 获取，保持颜色顺序）
const latestValues = computed(() => {
  if (!tasks.value.length)
    return []

  const latestMap = new Map<number, number | null>()
  for (const task of tasks.value) {
    for (let i = remoteData.value.length - 1; i >= 0; i--) {
      const rec = remoteData.value[i]
      if (rec && rec.task_id === task.id && rec.value >= 0) {
        latestMap.set(task.id, rec.value)
        break
      }
    }
  }

  return tasks.value.map((task, idx) => {
    const safeIdx = Math.max(0, idx % chartColors.length)
    return {
      ...task,
      latestValue: latestMap.get(task.id) ?? null,
      color: chartColors[safeIdx]!,
    }
  })
})

const selectedTasks = computed(() => {
  return tasks.value.filter(t => selectedTaskIds.value.includes(t.id))
})

const taskLabels = computed(() => pingChartTaskLabels(tasks.value))
const taskLabel = (id: number) => taskLabels.value.get(id) ?? `#${id}`

const visibleTaskIds = computed(() => selectedTasks.value
  .filter(task => !hiddenInLegend.value.has(task.id))
  .map(task => task.id))

const pingChartDisplayDomain = computed(() => {
  const window = activeTimeWindow.value
  if (!window)
    return null

  return resolvePingChartDisplayDomain({
    requestedStart: window.start,
    requestedEnd: window.end,
    selectedTaskIds: visibleTaskIds.value,
    samples: remoteData.value.map(record => ({
      taskId: record.task_id,
      time: record.time,
      finalized: record.finalized,
    })),
    preserveRequestedEnd: isCustomRange.value,
  })
})

function handleLegendSelectionChanged(event: unknown): void {
  clearChartHover()
  const selected = event && typeof event === 'object' && 'selected' in event
    ? (event as { selected?: Record<string, boolean> }).selected
    : undefined
  if (!selected)
    return
  const hidden = new Set(hiddenInLegend.value)
  for (const task of selectedTasks.value) {
    const label = taskLabel(task.id)
    if (selected[label] === false)
      hidden.add(task.id)
    else if (selected[label] === true)
      hidden.delete(task.id)
  }
  hiddenInLegend.value = hidden
}

watch(
  () => [selectedTaskIds.value.join(','), tasks.value.map(task => task.id).join(',')] as const,
  () => {
    clearChartHover()
  },
)

// 切换任务选中状态
function toggleTask(taskId: number) {
  followAllTasks = false
  if (selectedTaskIds.value.includes(taskId)) {
    selectedTaskIds.value = selectedTaskIds.value.filter(id => id !== taskId)
  }
  else {
    selectedTaskIds.value = [...selectedTaskIds.value, taskId]
  }
}

function showAllTasks() {
  followAllTasks = true
  selectedTaskIds.value = tasks.value.map(t => t.id)
}

function hideAllTasks() {
  followAllTasks = false
  selectedTaskIds.value = []
}

// ==================== 图表配置 ====================

// 通用 Tooltip 配置
const baseTooltipConfig = computed(() => ({
  trigger: 'axis' as const,
  confine: false,
  backgroundColor: chartThemeColors.value.tooltipBg,
  borderColor: appStore.glassColorPreset === 'custom' ? chartThemeColors.value.borderColor : 'transparent',
  borderWidth: 0,
  borderRadius: 6,
  textStyle: {
    color: chartThemeColors.value.text,
    fontSize: 12,
    lineHeight: 20,
  },
  extraCssText: `backdrop-filter: blur(5px);z-index:9;box-shadow:0 0 0 1px ${chartThemeColors.value.tooltipShadow}, 0 0 16px ${chartThemeColors.value.tooltipShadow}`,
  axisPointer: {
    type: 'cross' as const,
    crossStyle: {
      color: chartThemeColors.value.textTertiary,
    },
    lineStyle: {
      color: chartThemeColors.value.crosshairColor,
      width: 1,
      type: 'dashed' as const,
    },
    shadowStyle: {
      color: chartThemeColors.value.crosshairColor,
    },
  },
}))

const latencyChartOption = computed(() => {
  const taskList = selectedTasks.value
  const data = chartData.value
  const hours = selectedHours.value
  const displayDomain = pingChartDisplayDomain.value

  // 构建 series，确保颜色与卡片一致
  const series = taskList.map((task, index) => {
    const color = getTaskColor(task.id)
    const lineType = appStore.colorVisionFriendly
      ? (ACCESSIBLE_LINE_TYPES[index % ACCESSIBLE_LINE_TYPES.length] ?? 'solid')
      : 'solid'
    const points: ChartTuple[] = []
    for (const row of data) {
      if (!Object.hasOwn(row, task.id))
        continue
      const timestamp = parsePingTimestampMs(row.time)
      if (timestamp === null)
        continue
      const raw = row[task.id]
      points.push([timestamp, typeof raw === 'number' && Number.isFinite(raw) ? raw : null])
    }
    return {
      id: `latency-${task.id}`,
      name: taskLabel(task.id),
      type: 'line' as const,
      data: points,
      smooth: smoothPeaks.value ? 0.6 : false,
      ...chartSymbols(points),
      connectNulls: false,
      lineStyle: { width: 1.5, color, cap: 'round' as const, type: lineType },
      itemStyle: { color }, // 确保 symbol 颜色一致
    }
  })

  // 颜色映射表（用于 Tooltip）
  const colorMap = new Map<number, string>()
  tasks.value.forEach((task, idx) => {
    const safeIdx = Math.max(0, idx % chartColors.length)
    colorMap.set(task.id, chartColors[safeIdx]!)
  })

  return {
    animation: false,
    // 全局颜色设置（用于图例等）
    color: tasks.value.map((_, idx) => {
      const safeIdx = Math.max(0, idx % chartColors.length)
      return chartColors[safeIdx]!
    }),
    tooltip: {
      ...baseTooltipConfig.value,
      formatter: (params: unknown) => {
        const p = params as Array<{
          seriesName: string
          value: [number, number | null] | number | null
        }>
        if (!p.length)
          return ''
        const firstParam = p[0]
        if (!firstParam)
          return ''
        const firstValue = firstParam.value
        const timestamp = Array.isArray(firstValue) ? firstValue[0] : null
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp))
          return ''

        const timeStr = formatTimeForTooltip(timestamp, hours)
        let html = `<div style="font-weight:600;margin-bottom:6px;color:${chartThemeColors.value.textSecondary}">${timeStr}</div>`
        html += '<div style="display:flex;flex-direction:column;gap:4px">'

        for (const item of p) {
          const itemValue = Array.isArray(item.value) ? item.value[1] : item.value
          if (typeof itemValue === 'number' && Number.isFinite(itemValue)) {
            // 通过任务名找到对应的任务ID，再获取颜色
            const task = tasks.value.find(t => taskLabel(t.id) === item.seriesName)
            const color = task ? colorMap.get(task.id) || chartColors[0] : chartColors[0]
            const colorDot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:8px;flex-shrink:0"></span>`
            html += `<div style="display:flex;align-items:center">${colorDot}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapePingTooltip(item.seriesName)}</span><span style="margin-left:auto;font-weight:600;margin-left:16px;font-variant-numeric:tabular-nums">${Math.round(itemValue)} ms</span></div>`
          }
        }
        html += '</div>'
        return html
      },
    },
    legend: {
      type: 'scroll',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 12,
      itemGap: 16,
      icon: 'roundRect',
      textStyle: { fontSize: 11, color: chartThemeColors.value.textSecondary },
      data: taskList.map(t => taskLabel(t.id)),
      selected: Object.fromEntries(taskList.map(task => [taskLabel(task.id), !hiddenInLegend.value.has(task.id)])),
    },
    grid: chartMargin,
    xAxis: {
      type: 'time',
      min: displayDomain?.min,
      max: displayDomain?.max,
      axisLabel: {
        fontSize: 11,
        color: chartThemeColors.value.textSecondary,
        margin: 12,
        hideOverlap: true,
        formatter: (value: number | string) => formatTime(value, showDateInAxis.value),
      },
      axisLine: {
        show: true,
        lineStyle: { color: chartThemeColors.value.borderColor, width: 1 },
      },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      name: '延迟 (ms)',
      nameTextStyle: { color: chartThemeColors.value.textSecondary },
      axisLabel: { fontSize: 11, color: chartThemeColors.value.textSecondary, formatter: '{value}' },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        lineStyle: {
          color: chartThemeColors.value.splitLineColor,
          type: 'dashed' as const,
        },
      },
    },
    series,
  }
})

// ==================== 生命周期 ====================

// Presentation-only index. Exact source timestamps are not rounded or resampled.
const lossPoints = computed(() => new Map(remoteData.value.map(record => [
  `${record.task_id}:${parsePingTimestampMs(record.time)}`,
  pingLossPercent(record.lossRatio),
])))

const pingChartOption = computed(() => {
  const base = latencyChartOption.value
  if (!dualChart.value)
    return { ...base, tooltip: { ...base.tooltip, className: '', transitionDuration: 0.4 }, axisPointer: { link: [] } }

  const rows = new Map(chartData.value.map(row => [parsePingTimestampMs(row.time), row]))
  const lossSeries = base.series.map((series, index) => {
    const id = selectedTasks.value[index]!.id
    const points: ChartTuple[] = series.data.map(([t]) => [t, lossPoints.value.get(`${id}:${t}`) ?? null])
    return { ...series, id: `loss-${id}`, xAxisIndex: 1, yAxisIndex: 1, smooth: false, data: points, ...chartSymbols(points) }
  })
  return {
    ...base,
    // Both x axes have identical domains, pixel bounds and timestamp arrays.
    // ECharts links the already-snapped source value without snapping it again.
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { ...chartMargin, id: 'latency-grid', bottom: undefined, height: 206, outerBoundsMode: 'none' },
      { ...chartMargin, id: 'loss-grid', top: 296, outerBoundsMode: 'none' },
    ],
    xAxis: [0, 1].map(index => ({
      ...base.xAxis,
      id: `ping-time-${index}`,
      gridIndex: index,
      axisLabel: { ...base.xAxis.axisLabel, hideOverlap: true },
      axisPointer: { snap: true, label: { show: index === 1 } },
    })),
    yAxis: [
      { ...base.yAxis, id: 'latency-axis', gridIndex: 0, axisPointer: { show: false } },
      { ...base.yAxis, id: 'loss-axis', gridIndex: 1, name: '丢包 (%)', min: 0, max: 100, interval: 20, axisLabel: { ...base.yAxis.axisLabel, formatter: '{value}%' }, axisPointer: { show: false } },
    ],
    series: [...base.series, ...lossSeries],
    tooltip: {
      ...base.tooltip,
      confine: true,
      enterable: true,
      className: 'ping-shared-tooltip-shell',
      // Animated HTML tooltips also throttle positioning, replaying stale coordinates after rotation.
      transitionDuration: 0,
      axisPointer: { ...baseTooltipConfig.value.axisPointer, type: 'line' as const },
      formatter: (params: unknown) => {
        const points = params as Array<{ axisValue?: number | string, value?: [number, number | null] }>
        const first = points[0]
        const timestamp = Number(first?.axisValue ?? first?.value?.[0])
        const row = rows.get(timestamp)
        if (!row)
          return ''
        const taskRows = selectedTasks.value.filter(task => visibleTaskIds.value.includes(task.id)).map((task) => {
          const latency = row[task.id]
          const loss = lossPoints.value.get(`${task.id}:${timestamp}`) ?? null
          const lossCell = pingTooltipLoss(loss)
          const latencyText = typeof latency === 'number' && Number.isFinite(latency)
            ? `${Math.round(latency)} ms`
            : loss === 100 ? '不可达' : '—'
          return `<div class="ping-tooltip-row" data-task-id="${task.id}"><span class="ping-tooltip-name"><i style="background:${getTaskColor(task.id)}"></i><span>${escapePingTooltip(taskLabel(task.id))}</span></span><span class="ping-tooltip-number${latencyText === '不可达' ? ' ping-tooltip-abnormal' : ''}" data-ping-latency>${escapePingTooltip(latencyText)}</span><span class="ping-tooltip-number${lossCell.abnormal ? ' ping-tooltip-abnormal' : ''}" data-ping-loss>${escapePingTooltip(lossCell.text)}</span></div>`
        }).join('')
        return `<div data-ping-shared-tooltip><div class="ping-tooltip-time">${escapePingTooltip(formatTimeForTooltip(timestamp, selectedHours.value))}</div><div class="ping-tooltip-grid"><span>任务</span><span class="ping-tooltip-number">延迟</span><span class="ping-tooltip-number">丢包</span>${taskRows}</div></div>`
      },
    },
  }
})

watch(dualChart, clearChartHover)

watch(selectedView, () => {
  if (isCustomRange.value)
    ensureDefaultCustomRange()
  fetchRecords()
})

watch([() => props.uuid, getAuthSessionRevision], () => {
  clearChartHover()
  showLoss.value = true
  hiddenInLegend.value = new Set()
  remoteData.value = []
  tasks.value = []
  selectedTaskIds.value = []
  selectionAvailableTaskIds = null
  followAllTasks = true
  activeTaskTooltipId.value = null
  smoothInfoTooltipOpen.value = false
  fetchRecords()
})

onMounted(() => {
  syncTouchTooltipMode()
  coarsePointerMediaQuery = window.matchMedia('(pointer: coarse)')
  coarsePointerMediaQuery.addEventListener('change', syncTouchTooltipMode)

  const firstView = availableViews.value[0]
  if (firstView && !selectedView.value) {
    selectedView.value = firstView.label
  }
  fetchRecords()
})

onBeforeUnmount(() => {
  fetchRecordsSequence++
  coarsePointerMediaQuery?.removeEventListener('change', syncTouchTooltipMode)
})
</script>

<template>
  <div
    class="flex flex-col gap-4"
    data-ping-chart
    :data-ping-chart-loss="dualChart ? 'enabled' : 'disabled'"
    :data-ping-chart-smoothing="smoothPeaks ? 'enabled' : 'disabled'"
    data-ping-chart-axis-type="time"
    :data-ping-chart-window-start="activeTimeWindow?.start"
    :data-ping-chart-window-end="activeTimeWindow?.end"
    :data-ping-chart-display-start="pingChartDisplayDomain?.min"
    :data-ping-chart-display-end="pingChartDisplayDomain?.max"
    :data-ping-chart-latest-finalized="pingChartDisplayDomain?.latestFinalizedTimestamp ?? undefined"
    :data-ping-chart-visible-task-ids="visibleTaskIds.join(',')"
    :data-ping-chart-record-count="remoteData.length"
  >
    <!-- 时间选择器 -->
    <div class="flex flex-col gap-2">
      <Tabs v-model="selectedView" class="w-full items-center">
        <div class="min-w-0 flex-1 overflow-x-auto rounded-sm pointer-events-auto">
          <TabsList class="w-max h-8 bg-background/50 backdrop-blur-xl rounded-md">
            <TabsTrigger
              v-for="view in availableViews" :key="view.label" :value="view.label"
              class="h-6.5 flex-none shrink-0 text-xs border-none data-[state=active]:text-green-600 shadow-none rounded-sm"
            >
              {{ view.label }}
            </TabsTrigger>
          </TabsList>
        </div>
        <div class="md:flex-1" />
        <div class="flex gap-2 items-center">
          <Button
            variant="ghost" size="xs" class="h-7 rounded-sm bg-background/50 hover:bg-background border-none"
            :class="selectedTaskIds.length === tasks.length ? 'shadow-[0_0_0_2px] shadow-green-600/10 text-green-600' : ''"
            @click="showAllTasks"
          >
            全选
          </Button>
          <Button
            variant="ghost" size="xs" class="h-7 rounded-sm bg-background/50 hover:bg-background border-none"
            :class="!selectedTaskIds.length && 'shadow-[0_0_0_2px] shadow-green-600/10 text-green-600'"
            @click="hideAllTasks"
          >
            全不选
          </Button>
        </div>
      </Tabs>

      <div v-if="isCustomRange" class="flex w-full flex-col items-center gap-2 sm:flex-row sm:justify-center">
        <div class="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(0,13rem)_minmax(0,13rem)_auto]">
          <Input
            v-model="customStartInput"
            type="datetime-local"
            aria-label="延迟图开始时间"
            class="h-8 bg-background/50 text-xs"
          />
          <Input
            v-model="customEndInput"
            type="datetime-local"
            aria-label="延迟图结束时间"
            class="h-8 bg-background/50 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            :disabled="!customRange"
            class="h-8 text-xs"
            @click="fetchRecords"
          >
            应用
          </Button>
        </div>
        <div v-if="customRangeError" class="text-[11px] text-orange-500">
          {{ customRangeError }}
        </div>
        <div v-else-if="legacyCustomRangeFallback" class="text-[11px] text-muted-foreground">
          旧接口按可用保留时长回溯，再裁剪到所选区间
        </div>
      </div>
    </div>

    <!-- 内容区域 -->
    <Spinner :show="loading" content-class="flex flex-col gap-4">
      <div v-if="error" class="text-red-500 py-8 text-center">
        {{ error }}
      </div>
      <div v-else-if="tasks.length === 0 && !loading" class="py-8">
        <Empty description="暂无延迟数据" />
      </div>

      <template v-else>
        <!-- 最新值统计卡片（可点击切换选中状态） -->
        <div
          v-if="latestValues.length > 0" class="gap-3 grid"
          style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))"
        >
          <div
            v-for="task in latestValues" :key="task.id"
            class="p-2 rounded-md bg-background/50 hover:bg-background hover:shadow-[0_0_0_2px] hover:shadow-primary/10 flex gap-3 cursor-pointer select-none transition-all items-center"
            :class="[!selectedTaskIds.includes(task.id) && 'opacity-30']"
            :data-ping-chart-task-id="task.id"
            :onmouseover="(e: MouseEvent) => ((e.currentTarget as HTMLElement).style.borderColor = task.color)"
            :onmouseout="(e: MouseEvent) => ((e.currentTarget as HTMLElement).style.borderColor = '')"
            @click="toggleTask(task.id)"
          >
            <div class="flex-1 min-w-0">
              <TooltipProvider>
                <div class="flex gap-2 items-center">
                  <div class="rounded h-4 w-1" :style="{ backgroundColor: task.color }" />
                  <span class="text-sm font-semibold truncate">{{ taskLabel(task.id) }}</span>
                  <div class="flex-1" />
                  <Tooltip
                    :open="isTouchTooltipMode ? activeTaskTooltipId === task.id : undefined"
                    @update:open="(open) => setTaskTooltipOpen(task.id, open)"
                  >
                    <TooltipTrigger as-child>
                      <Button variant="ghost" size="icon-xs" class="text-slate-500" @click.stop="toggleTaskTooltip(task.id)">
                        <Icon icon="carbon:information" :width="14" :height="14" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent class="ping-task-statistics !rounded p-3">
                      <div class="text-xs gap-x-4 gap-y-1.5 grid grid-cols-4">
                        <template v-if="task.min !== undefined">
                          <span class="text-muted-foreground">最小</span>
                          <span class="font-medium">{{ Math.round(task.min) }} ms</span>
                        </template>
                        <template v-if="task.max !== undefined">
                          <span class="text-muted-foreground">最大</span>
                          <span class="font-medium">{{ Math.round(task.max) }} ms</span>
                        </template>
                        <template v-if="task.avg !== undefined">
                          <span class="text-muted-foreground">平均</span>
                          <span class="font-medium">{{ Math.round(task.avg) }} ms</span>
                        </template>
                        <template v-if="task.latest !== undefined">
                          <span class="text-muted-foreground">最新</span>
                          <span class="font-medium">{{ Math.round(task.latest) }} ms</span>
                        </template>
                        <template v-if="task.p50 !== undefined">
                          <span class="text-muted-foreground">P50</span>
                          <span class="font-medium">{{ Math.round(task.p50) }} ms</span>
                        </template>
                        <template v-if="task.p99 !== undefined">
                          <span class="text-muted-foreground">P99</span>
                          <span class="font-medium">{{ Math.round(task.p99) }} ms</span>
                        </template>
                        <template v-if="task.p99_p50_ratio !== undefined">
                          <span class="text-muted-foreground">波动率</span>
                          <span class="font-medium">{{ task.p99_p50_ratio.toFixed(2) }}</span>
                        </template>
                        <template v-if="task.interval !== undefined">
                          <span class="text-muted-foreground">间隔</span>
                          <span class="font-medium">{{ task.interval }}s</span>
                        </template>
                        <template v-if="task.type">
                          <span class="text-muted-foreground">类型</span>
                          <span class="font-medium">{{ task.type.toUpperCase() }}</span>
                        </template>
                        <template v-if="task.stddev !== undefined">
                          <span class="text-muted-foreground">标准差</span>
                          <span class="font-medium">{{ task.stddev.toFixed(1) }}</span>
                        </template>
                        <template v-if="task.total !== undefined">
                          <span class="text-muted-foreground">总数</span>
                          <span class="font-medium">{{ task.total }}</span>
                        </template>
                        <template v-if="task.valid !== undefined">
                          <span class="text-muted-foreground">有效</span>
                          <span class="font-medium">{{ task.valid }}</span>
                        </template>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
              <div class="text-xs mt-1 flex gap-1.5 items-center text-muted-foreground">
                <span class="font-medium" title="平均延迟">
                  {{ task.avg !== undefined ? `${Math.round(task.avg)}ms` : '-' }}
                </span>
                <span class="opacity-60">·</span>
                <span title="丢包率">{{ task.lossAvailable === false ? '-' : `${task.loss.toFixed(2)}%${task.loss_approximate ? '≈' : ''}` }}</span>
                <template v-if="task.p99_p50_ratio !== undefined">
                  <span class="opacity-60">·</span>
                  <span title="波动率">{{ task.p99_p50_ratio.toFixed(2) }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>

        <TooltipProvider>
          <div class="flex flex-wrap items-center gap-2 py-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              :class="smoothPeaks && 'border-green-600/50 bg-green-600/10 text-green-700 dark:text-green-400'"
              :aria-pressed="smoothPeaks"
              @click="smoothPeaks = !smoothPeaks"
            >
              平滑峰值
            </Button>
            <Button
              v-if="lossHistory"
              type="button"
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              :class="showLoss && 'border-green-600/50 bg-green-600/10 text-green-700 dark:text-green-400'"
              :aria-pressed="showLoss"
              @click="showLoss = !showLoss"
            >
              丢包数据
            </Button>
            <Tooltip
              :open="isTouchTooltipMode ? smoothInfoTooltipOpen : undefined"
              @update:open="setSmoothInfoTooltipOpen"
            >
              <TooltipTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  class="text-slate-500"
                  aria-label="平滑峰值说明"
                  @click.stop="toggleSmoothInfoTooltip"
                >
                  <Icon icon="carbon:information" :width="14" :height="14" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>仅平滑真实采样点；不填补缺失或待采样数据。</span>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        <!-- 图表 -->
        <div ref="chartHost" class="ping-chart-host bg-background/50 p-4 rounded-md" :class="dualChart ? 'h-[560px]' : 'h-80'" @mouseleave="clearChartHover">
          <!-- Task inventory changes must replace visible series, not infer color as a component. -->
          <VChart ref="chart" :option="pingChartOption" :update-options="{ replaceMerge: ['series', 'grid', 'xAxis', 'yAxis'] }" autoresize @legendselectchanged="handleLegendSelectionChanged" />
        </div>
      </template>
    </Spinner>
  </div>
</template>

<style scoped>
.ping-chart-host {
  container-type: inline-size;
}

/* The shell is inserted by ECharts inside this chart, not a global Portal. */
.ping-chart-host :deep(.ping-shared-tooltip-shell) {
  --ping-tooltip-max: min(440px, calc(100cqw - 24px), calc(100vw - 32px));
  box-sizing: border-box;
  width: max-content;
  max-width: var(--ping-tooltip-max);
}

.ping-chart-host :deep([data-ping-shared-tooltip]) {
  box-sizing: border-box;
  width: max-content;
  max-width: calc(var(--ping-tooltip-max) - 20px);
  max-height: min(320px, 50vh);
  /* WebKit overlay scrollbars may not reserve scrollbar-gutter space. */
  padding-inline-end: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
  overscroll-behavior-y: contain;
  touch-action: pan-y pinch-zoom;
  -webkit-overflow-scrolling: touch;
}

.ping-chart-host :deep(.ping-tooltip-time) {
  margin-bottom: 6px;
  font-weight: 600;
}

.ping-chart-host :deep(.ping-tooltip-grid) {
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(7ch, max-content) minmax(7ch, max-content);
  gap: 5px 12px;
}

.ping-chart-host :deep(.ping-tooltip-row) {
  display: contents;
}

.ping-chart-host :deep(.ping-tooltip-name) {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ping-chart-host :deep(.ping-tooltip-name > i) {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
}

.ping-chart-host :deep(.ping-tooltip-name > span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ping-chart-host :deep(.ping-tooltip-number) {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ping-chart-host :deep(.ping-tooltip-abnormal) {
  color: var(--destructive);
}

/* The Portal does not inherit the parent's scope attribute. Target only this
   statistics instance's class, pairing its opaque surface and foreground. */
:global(.ping-task-statistics) {
  max-width: calc(100vw - 24px);
  border: 1px solid var(--border);
  background: var(--popover);
  color: var(--popover-foreground);
}

:global(.ping-task-statistics > .grid) {
  grid-template-columns: repeat(2, auto max-content);
}

:global(.ping-task-statistics > .grid > span) {
  white-space: nowrap;
}

:global(.ping-task-statistics svg) {
  background: var(--popover);
  fill: var(--popover);
}

@media (max-width: 359px) {
  :global(.ping-task-statistics > .grid) {
    grid-template-columns: auto max-content;
  }
}
</style>
