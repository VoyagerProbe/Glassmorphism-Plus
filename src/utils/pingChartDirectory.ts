import type { PingTaskInfo } from '@/utils/rpc'
import { RpcError } from '@/utils/rpc'

const digitsOnly = /^\d+$/u

export function pingReadDenied(error: unknown): boolean {
  return error instanceof RpcError && [401, 403, -32040, -32041].includes(error.code)
}

export function currentPingId(value: unknown): number {
  if (typeof value !== 'number' && !(typeof value === 'string' && digitsOnly.test(value)))
    return Number.NaN
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : Number.NaN
}

/** Validate before filtering: a malformed response is not an authoritative empty directory. */
export function assignedChartTasks(rows: readonly PingTaskInfo[], uuid: string, nodeScoped = false): PingTaskInfo[] {
  if (!Array.isArray(rows))
    throw new Error('无法确认当前节点的 Ping 任务目录')
  const seen = new Set<number>()
  const assigned: PingTaskInfo[] = []
  for (const row of rows) {
    const id = currentPingId(row?.id)
    const bindings = row?.clients
    if (!Number.isFinite(id) || seen.has(id) || typeof row?.name !== 'string' || !row.name.trim()
      || (bindings == null ? !nodeScoped && bindings !== null : !Array.isArray(bindings) || bindings.some((item: unknown) => typeof item !== 'string' || !item.trim()))) {
      throw new Error('Ping 任务目录不完整，无法确认当前任务')
    }
    seen.add(id)
    if ((nodeScoped && bindings === undefined) || bindings?.some((client: string) => client.trim().toLowerCase() === uuid.toLowerCase()))
      assigned.push({ ...row, id, name: row.name.trim() })
  }
  return assigned
}
