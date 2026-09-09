/** Display conversion only: ping.loss has an explicit ratio (0..1) contract. */
export function pingLossPercent(ratio: unknown): number | null {
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1
    ? ratio * 100
    : null
}

const htmlSpecialCharacters = /[&<>"']/g

export function escapePingTooltip(value: string): string {
  return value.replace(htmlSpecialCharacters, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[character]!)
}

/** ECharts links legend entries by name; duplicate backend names need unique labels. */
export function pingChartTaskLabels(tasks: ReadonlyArray<{ id: number, name: string }>): Map<number, string> {
  const counts = new Map<string, number>()
  for (const task of tasks) counts.set(task.name, (counts.get(task.name) ?? 0) + 1)
  const labels = new Map<number, string>()
  const used = new Set<string>()
  for (const task of tasks) {
    let label = counts.get(task.name)! > 1 ? `${task.name} · #${task.id}` : task.name
    while (used.has(label)) label += ` · #${task.id}`
    used.add(label)
    labels.set(task.id, label)
  }
  return labels
}
