import type { MetricQueryParams, MetricQueryResponse } from '@/utils/rpc'
import { CACHE_CONFIG } from '@/constants/cache'
import { TIME_MS } from '@/constants/time'
import { getAuthSessionRevision } from '@/services/auth.service'
import { SharedCache } from '@/services/cache.service'
import { getQueryMetricsRequestKey, queryMetrics } from '@/services/metrics.service'
import { pingReadDenied } from '@/utils/pingChartDirectory'

// Complete, successful paired responses only. A latency-only NodeCard read, a
// different end, aggregation, point budget or permission revision is not proof.
const receipts = new SharedCache<MetricQueryResponse>({
  maxSize: 32,
  ttl: 2 * TIME_MS.minute,
  cleanupInterval: CACHE_CONFIG.cleanup.interval,
})

export async function readChartMetricWindow(params: MetricQueryParams, intent: 'window' | 'supplement'): Promise<MetricQueryResponse> {
  const start = Date.parse(String(params.start))
  const end = Date.parse(String(params.end))
  if (!(end > start && end - start <= TIME_MS.day))
    return queryMetrics(params)
  const key = getQueryMetricsRequestKey(params)
  // Only background coverage may reuse a completed receipt. Reopening a
  // user-selected range reads that range again, as in the published chart.
  const cached = intent === 'supplement' ? receipts.get(key) : undefined
  if (cached)
    return cached
  const revision = getAuthSessionRevision()
  const response = await queryMetrics(params)
  if (revision === getAuthSessionRevision())
    receipts.set(key, response)
  return response
}

interface TailRow {
  task_id: number
  time: string
  value: number
  finalized: boolean
  lossRatio?: number | null
}
function drawable(row: TailRow): boolean {
  return row.finalized && (row.value >= 0 || row.lossRatio != null)
}

/**
 * One node/window, not one request per task. Need is determined from the
 * official, already stitched response. A successful *loss* observation also
 * covers a task. Never merge the entire short response into healthy series.
 */
export async function restoreMissingChartRows<T extends TailRow>(
  base: T[],
  ids: ReadonlySet<number>,
  params: MetricQueryParams,
  decode: (response: MetricQueryResponse, since: number, until: number) => T[],
  current: () => boolean,
): Promise<T[]> {
  const end = Date.parse(String(params.end))
  const width = end - Date.parse(String(params.start))
  // The one-day response is a source for longer charts, not a destination:
  // an empty one-day series must not be repopulated from a prior 1/6/12h read.
  if (width <= TIME_MS.day || !current())
    return base
  const observed = new Map<number, number>()
  for (const row of base) {
    if (drawable(row))
      observed.set(row.task_id, (observed.get(row.task_id) ?? 0) + 1)
  }
  const missing = new Set([...ids].filter(id => !observed.has(id)))
  // If a task has just one plotted bucket, an exact, already-read short
  // response can positively establish additional real timestamps. Do not
  // infer that every established task is missing its last hour.
  const single = new Set([...observed].filter(([, count]) => count === 1).map(([id]) => id))
  if (!missing.size && !single.size)
    return base
  const accepted = new Map<number, T[]>()
  const at = (hours: number) => ({ ...params, start: new Date(end - hours * TIME_MS.hour).toISOString() })
  const singletonTimes = new Map(base.filter(row => single.has(row.task_id) && drawable(row)).map(row => [row.task_id, row.time]))
  const accept = (response: MetricQueryResponse, hours: number, fromCache: boolean) => {
    const grouped = new Map<number, T[]>()
    for (const row of decode(response, end - hours * TIME_MS.hour, end)) {
      if (!missing.has(row.task_id) && !(fromCache && single.has(row.task_id)))
        continue
      const rows = grouped.get(row.task_id) ?? []
      rows.push(row)
      grouped.set(row.task_id, rows)
    }
    for (const [id, rows] of grouped) {
      if (!rows.some(row => drawable(row) && (missing.has(id) || row.time !== singletonTimes.get(id))))
        continue
      // Do not introduce a start-of-short-window padding null as a new
      // historical outage. Keep explicit holes *between* accepted observations.
      const first = rows.findIndex(drawable)
      let last = rows.length - 1
      while (last > first && !drawable(rows[last]!))
        last--
      accepted.set(id, rows.slice(first, last + 1))
      missing.delete(id)
      single.delete(id)
    }
  }
  // Widest usable short window first; do not stack overlapping tiers.
  for (const hours of [24, 12, 6, 1]) {
    if (!current() || (!missing.size && !single.size))
      break
    if (hours * TIME_MS.hour >= width)
      continue
    const cached = receipts.get(getQueryMetricsRequestKey(at(hours)))
    if (cached)
      accept(cached, hours, true)
  }
  for (const hours of [24, 1]) {
    if (!current() || !missing.size)
      break
    if (hours * TIME_MS.hour >= width)
      continue
    const short = at(hours)
    if (receipts.get(getQueryMetricsRequestKey(short)))
      continue
    try {
      const response = await readChartMetricWindow(short, 'supplement')
      if (current())
        accept(response, hours, false)
    }
    catch (error) {
      if (pingReadDenied(error))
        throw error
      break
    }
  }
  if (!accepted.size || !current())
    return base
  const key = (row: T) => `${row.task_id}:${row.time}`
  const retained = new Map(base.map(row => [key(row), row]))
  for (const rows of accepted.values()) {
    for (const row of rows) {
      const existing = retained.get(key(row))
      if (!existing || (!drawable(existing) && (drawable(row) || !existing.finalized)))
        retained.set(key(row), row)
    }
  }
  return [...retained.values()]
}
