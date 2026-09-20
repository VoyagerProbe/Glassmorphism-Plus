# v2.8.2 启动与旧 Worker 兼容

状态：同版本 Pre-release 兼容修复。需重新下载同名客户 ZIP 导入；不是 v2.8.3，不自动恢复 Latest。原 iPhone iOS 27 Safari 的具体版本、普通／私密／主屏幕模式、第一条异常与 controller 尚未取得。不能将 Chromium 或 Playwright WebKit 结果写成原 Safari 已恢复。

## 已知事故与边界

用户原 Chrome 的根文档来自旧 `/sw.js`，引用已不在当前包里的旧入口，服务器回退为 HTML，引发模块 MIME 错误。Bypass 后恢复；用户实际删除过 **Workbox precache 和 api-cache 两项**，设置保留是用户观察，并非导出全部存储后逐字节核验。这段历史不因新测试而改写。

Safari 黑屏尚只是现象报告。若设备收到正确 JS 后出现语法或运行时异常，应保留首条异常并另行诊断，不将所有问题归咎于缓存。

## 运行合同

- 固定 Komari 1.5.0-fix1 正常静态路由先读当前主题 `dist`，故 `public/sw.js` 原样构建为 `dist/sw.js`，由原 `/sw.js` 提供。Linux 官方二进制隔离实测确认 JS MIME、无重定向及字节匹配；原注册查询参数由 `registration.update()` 保留，不注册新名称。
- Worker 只包含 install、activate 和固定状态消息，无 fetch／respondWith／代理或新缓存。skipWaiting 后以 waitUntil 绑定迁移及 claim；不遍历导航客户端，不注销注册。已失败模块需要新的正常导航才能执行。
- **根 scope `/` 包含同源前台与后台**：原官方 Worker 的离线外壳和相关运行时缓存能力不再使用，优先在线正确性。不是单一 Vue 组件的局部影响，也不是全新离线系统。未对真实 Agent 终端会话做端到端连接证明。
- 无 Worker 的访客不会被恢复页创建新注册。其它 scriptURL、不同 scope 和无法确认归属的注册拒绝修改；不动 Cookie、localStorage、IndexedDB、收藏、颜色、Ping 绑定及无关 Worker。
- 保留 Cache Storage，包括 api-cache。唯一例外为实测会在切回官方主题时复活的旧 Plus index：精确 cache `workbox-precache-v2-${origin}/`、精确根 index URL、revision `01deecf312fd6fdfacc090ce81267cba`、3816 字节 HTML，以及以下 SHA 必须全部匹配。仅删除该条目，任何条件不匹配均保留。

| 原 HTML       | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| 已核对 v2.8.1 | `442422019562099f6c7200fa42882823278afaaaa45882b263b00469ba649d47` |
| 原 v2.8.2     | `c809d20b628fae18e97675262dba96544d6736bde8936806c0ece047c211d3f4` |

自定义修改过的旧外壳、其它官方 revision 或部署前缀未获得这项删除权限；保留并报告，不扩大清理。当前恢复页只接受已实证的根路径部署，不将任意反代前缀假定为已兼容。

## 独立恢复路径

安装候选包并启用 Plus 后，在**原故障浏览器**打开同源路径：

`/themes/glassmorphism-plus/dist/plus-recovery.html`

此路径在真实旧官方 NavigationRoute 控制的 profile 中可到达；不依赖 Vue、ECharts、旧 hash chunk 或 CDN。页面核对主题 manifest、原根注册及当前脚本与包内脚本字节，用户点击“更新浏览器兼容组件”后进行一次 update，并有界等待真实激活／接管及固定诊断响应。超时、离线、尚未部署、存储拒绝时显示未完成和重试，不循环重载。返回目标固定当前 origin 首页，忽略任意 return 参数。

自动更新时机由浏览器决定，不能保证 Safari 第一刷同步恢复。测试中的自然更新路径允许第一导航仍旧，观察激活后再正常导航；恢复页是一次迁移入口，不是每次访问必经步骤。新 HTML 的入口失败提示只是补充，无法让旧 HTML 执行新代码。

## 升级与切换

兼容文件必须持续保留在 Plus 包中，不能在某台设备恢复后移除，否则后端又会回退官方 Worker。后台再次注册相同 URL 时仍获得兼容脚本。切回官方主题后，原 URL 由官方重新提供其 Worker，经正常生命周期恢复官方行为；再启用 Plus 则再次更新至兼容 Worker。不设置跨主题永久开关，不保留多套旧 assets。

受限启动模式必须继续提供官方登录／数据库恢复界面并拒绝第三方主题资源；本层不绕过它。部署站点的 CDN 缓存策略与用户原 Safari 仍需安装后验证，不能由隔离服务器的 GET 成功推及全部生产反代。

## 测试与证据范围

- 初始探针使用真实 v2.8.1 和原 v2.8.2 ZIP、官方 fix1 Worker 与同 origin／同 profile，重现旧入口 MIME 故障；Linux [初始路由证据](https://github.com/VoyagerProbe/Glassmorphism-Plus/actions/runs/35499586322) 已通过。这不是最终候选全矩阵结论。
- 常驻回归使用真实历史 A，B 为当前构建移除兼容资源的测试包，C 为当前构建，D 为实际改变入口 bytes 与内容哈希文件名的测试产物。B/D 仅为隔离 fixture，不是历史原包或新 Release。未清站点资料、未勾 Bypass、未用 mock 替代旧官方 Worker。
- 覆盖恢复页迁移、单个有害 HTML 失效、其余 532 个预快取内容保留、合成 Cookie／偏好／绑定／IndexedDB／api-cache 哨兵、不同 scope Worker、后台实际未保存输入与保存读回、后续入口变化、官方主题往返、无 SW API／存储拒绝／离线／开放重定向边界及自然更新。
- [Linux 完整迁移及 WebKit 证据](https://github.com/VoyagerProbe/Glassmorphism-Plus/actions/runs/35501590287) 已通过：Chromium 自然更新保留原 `/sw.js?existing-query=1`，第一导航仍为旧外壳，激活后再一次正常导航取得当前入口；真实受限启动模式仍拒绝第三方恢复资源，回到正常模式后重新取得兼容 Worker。Linux 和 Windows 的 Playwright WebKit 均实际启用 SW 并通过迁移，不使用 `serviceWorkers: 'block'`。
- 单元模拟仅验证安全拒绝边界，不冒充真实 Worker 集成。仅新 HTML 提示测试注入入口／API 网络失败，分别断言显示／不显示恢复提示。完整已有 Code Quality、Visual Regression 与 WebKit UI 保护仍是发布前独立门槛，不过滤或降低断言；它们也不能代替原 Safari 实机确认。
- 合成数据库、浏览器 profile、日志和原始响应均留在 Git 与客户 ZIP 之外。安装 ZIP 只包含 manifest、preview 和 dist，兼容资源必须原样进入 dist 并通过校验。

候选包发布后，请分别在原 Safari 普通标签、私密浏览及主屏幕 Web App（若使用）记录结果；未使用的模式记未测试。无需预先清除网站数据。若恢复页未完成，反馈其简短状态；若已完成仍黑屏，提供首条错误／失败 JS 路径，遮住凭据。

## 只读实现依据

- [Chrome：同 URL 无 fetch Worker 迁移](https://developer.chrome.com/docs/workbox/remove-buggy-service-workers)。本实现不复制其全客户端导航示例。
- [Komari 固定 fix1 静态路由](https://github.com/komari-monitor/komari/blob/0ca87aafd184ed75f9030ede0902772142af5eec/web/public/public.go)。
- MDN：[update](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update)、[skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting)、[claim](https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim)。
