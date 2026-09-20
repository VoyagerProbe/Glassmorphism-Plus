/* Independent, fixed-address recovery; intentionally no application imports. */
(() => {
  const path = '/themes/glassmorphism-plus/dist/plus-recovery.html'
  const status = document.getElementById('status')
  const button = document.getElementById('update')
  const home = document.getElementById('home')
  const id = 'plus-online-v1'
  const origin = location.origin
  // Return/query parameters are deliberately never used as navigation targets.
  home.href = `${origin}/`
  if (location.pathname !== path || !globalThis.isSecureContext || !navigator.serviceWorker || typeof navigator.serviceWorker.getRegistration !== 'function') {
    status.textContent = '本页面地址或浏览器能力不支持此恢复操作。未修改任何注册；可以直接返回首页。'
    return
  }
  const say = (text) => {
    status.textContent = text
  }
  async function get(path) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(new URL(path, origin), { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal })
      if (!response.ok)
        throw new Error('所需兼容资源未就绪')
      return { type: response.headers.get('content-type') || '', text: await response.text() }
    }
    finally {
      clearTimeout(timer)
    }
  }
  async function ownedRegistration() {
    const registration = await navigator.serviceWorker.getRegistration(`${origin}/`)
    if (!registration)
      return null
    if (registration.scope !== `${origin}/`)
      throw new Error('不是已验证的根作用域，未修改该注册')
    const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean)
    if (!workers.length || workers.some((worker) => {
      const url = new URL(worker.scriptURL)
      return url.origin !== origin || url.pathname !== '/sw.js' || Boolean(url.hash)
    })) {
      throw new Error('不是本实例已知组件地址，未修改该注册')
    }
    const manifest = JSON.parse((await get('/themes/glassmorphism-plus/komari-theme.json')).text)
    if (manifest.short !== 'glassmorphism-plus' || manifest.author !== 'VoyagerProbe' || manifest.url !== 'https://github.com/VoyagerProbe/Glassmorphism-Plus')
      throw new Error('无法确认本实例主题归属')
    const scriptURL = workers[0].scriptURL
    const [packaged, served] = await Promise.all([get('/themes/glassmorphism-plus/dist/sw.js'), get(scriptURL)])
    if (!packaged.type.includes('javascript') || !served.type.includes('javascript') || packaged.text !== served.text || !served.text.includes(`const compatibilityId = '${id}'`))
      throw new Error('当前站点尚未提供兼容组件，或资源被缓存／路由替换')
    return registration
  }
  function identify(worker) {
    return new Promise((resolve) => {
      const channel = new MessageChannel()
      let timer
      const finish = (value) => {
        clearTimeout(timer)
        channel.port1.close()
        resolve(value)
      }
      timer = setTimeout(finish, 700, false)
      channel.port1.onmessage = event => finish(event.data?.compatibilityId === id && event.data?.mode === 'online-no-fetch')
      try {
        worker.postMessage('PLUS_COMPAT_STATUS_V1', [channel.port2])
      }
      catch {
        finish(false)
      }
    })
  }
  async function observe(registration, deadline) {
    // Bounded observation only. Never navigates clients or waits on .ready.
    while (Date.now() < deadline) {
      const active = registration.active
      if (active?.state === 'activated' && navigator.serviceWorker.controller === active && await identify(active))
        return true
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    return false
  }
  button.addEventListener('click', async () => {
    button.disabled = true
    say('正在核对本实例组件；尚未完成。')
    try {
      if (!navigator.onLine)
        throw new Error('当前离线，请联网后重试')
      const registration = await ownedRegistration()
      if (!registration) {
        say('没有发现旧根组件；未创建新注册。请返回首页，若仍黑屏需检查第一条实际错误。')
        return
      }
      say('已核对组件，正在请求更新并等待真实激活；不会刷新其他标签页。')
      let timer
      try {
        await Promise.race([
          registration.update(),
          new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('更新请求超时')), 15000) }),
        ])
      }
      finally {
        clearTimeout(timer)
      }
      if (!await observe(registration, Date.now() + 30000))
        throw new Error('尚未观察到兼容组件激活并接管。请保持联网，稍后重试')
      say('已完成：在线兼容组件已激活并接管本页。请点击“返回监控首页”重新加载应用。')
    }
    catch (error) {
      say(`未完成：${error instanceof Error ? error.message : '浏览器拒绝了此操作'}。未清除网站资料。`)
    }
    finally {
      button.disabled = false
    }
  })
  say('请点击按钮检查并更新本实例已有组件。不会为新访客创建注册。')
  button.disabled = false
})()
