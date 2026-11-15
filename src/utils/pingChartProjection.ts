import type { PingMetricSample } from '@/utils/pingMetricSamples'
import type { PingTimeWindow } from '@/utils/pingTime'
import type { MetricSeries } from '@/utils/rpc'
import { normalizeMetricSeriesList } from '@/utils/metricSeries'
import { currentPingId } from '@/utils/pingChartDirectory'
import { chartDimensionKey } from '@/utils/pingMetricCoverage'
import { normalizePingMetricSamples } from '@/utils/pingMetricSamples'

/**
 * Pair only like dimensions; labels are not identity. The backend normally
 * emits just task_id. Do not pair an unrelated target's loss with its latency.
 */
export function chartMetricSamples(series: MetricSeries[], entityId: string, window: PingTimeWindow): PingMetricSample[] {
  const partitions = new Map<string, MetricSeries[]>()
  for (const s of normalizeMetricSeriesList(series)) {
    if (s.entity_id.toLowerCase() !== entityId.toLowerCase() || !Number.isFinite(currentPingId(s.tags.task_id)))
      continue
    const key = chartDimensionKey(s.tags)
    const group = partitions.get(key) ?? []
    group.push(s)
    partitions.set(key, group)
  }
  const projected = new Map<string, PingMetricSample>()
  for (const group of partitions.values()) {
    for (const sample of normalizePingMetricSamples(group, { entityId, start: window.start, end: window.end, signedPingAverage: true })) {
      const key = `${sample.taskId}:${sample.timestamp}`
      const old = projected.get(key)
      if (!old || (!old.observed && sample.observed)) {
        projected.set(key, sample)
      }
      else if (old.observed === sample.observed) {
        // Incomparable simultaneous dimensions cannot be averaged into one
        // task line. Keep unambiguous metric values and preserve the gap.
        if (old.latency !== sample.latency)
          old.latency = null
        if (old.loss !== sample.loss)
          old.loss = null
        old.totalCount = Math.max(old.totalCount, sample.totalCount)
      }
    }
  }
  return [...projected.values()].sort((a, b) => a.timestamp - b.timestamp)
}

export type ChartTuple = [number, number | null]
export function chartSymbols(points: readonly ChartTuple[]) {
  let count = 0
  for (const [, value] of points) {
    if (value !== null && ++count > 1)
      break
  }
  // Reset the pinned ECharts line defaults as an ID moves from one to many
  // points: setOption merges existing series by ID, including symbol options.
  return count === 1
    ? { showSymbol: true, showAllSymbol: true, symbol: 'circle', symbolSize: 4 }
    : { showSymbol: false, showAllSymbol: 'auto' as const, symbol: 'emptyCircle', symbolSize: 6 }
}
