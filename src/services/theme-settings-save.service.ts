/**
 * One bounded queue for this page's full-object theme writes (palette and Ping).
 * This is not a cross-browser CAS; the backend exposes no revision precondition.
 */
let tail: Promise<void> = Promise.resolve()
let pending = 0

export function enqueueThemeSettingsSave<T>(task: () => Promise<T>): Promise<T> {
  if (pending >= 8)
    return Promise.reject(new Error('主题设置保存队列已满，请稍后重试'))
  pending++
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true
      reject(new Error('等待主题设置保存超时，请稍后重试'))
    }, 30_000)
  })
  const result = tail.then(() => {
    clearTimeout(timer)
    if (expired)
      throw new Error('主题设置保存已取消')
    return task()
  })
  tail = result.then(() => undefined, () => undefined).finally(() => {
    pending--
  })
  return Promise.race([result, timeout]).finally(() => clearTimeout(timer))
}

/** Never turn an unreadable full settings document into an empty replacement. */
export function parseThemeSettingsForSave(value: unknown): Record<string, unknown> {
  let parsed = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    }
    catch {
      throw new Error('主题设置 JSON 无效，已停止保存以保护原配置')
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('主题设置格式无效，已停止保存以保护原配置')
  return { ...parsed as Record<string, unknown> }
}

export function settingsValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b))
    return true
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => settingsValueEqual(item, b[index]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object')
    return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every(key => Object.hasOwn(right, key) && settingsValueEqual(left[key], right[key]))
}
