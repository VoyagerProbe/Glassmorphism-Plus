# v2.8.4：Ping 时间轴与 Komari 1.5.1

## 时间轴根因与最小修复

两个入口共用 `src/components/PingChart.vue`。锁定 ECharts 6.1.0、vue-echarts 8.0.1；既有 `replaceMerge` 已正确移除多余 grid、xAxis、yAxis、series，`autoresize` 的实际尺寸也与容器一致。

用户实际观察发生于 iPhone／移动端窄屏，桌面端是正常非回归基线。旧版在 390px 的首页弹窗和详情页中，关闭丢包图后均出现可见时间标签相交。排除 Tooltip／axisPointer 后，实际模型仅一组轴，单图输入没有 `axisLabel.hideOverlap`，双图则明确启用了该项。因此只在基础时间轴补充 `hideOverlap: true`，保留既有布局、字号、time 轴、时间边界与更新策略，不重建图表、不重采样。

`tests/visual/ping-axis-layout.spec.ts` 分别观察实际 chart host、ECharts 宽度、DPR、visual viewport、Vue 输入、有效模型及轴视图的实际 Text 边界，并保留 Canvas 截图。它覆盖 360／375／390／393／430px、桌面、两个入口、同实例十次切换、初始单图对照、1h／12h／跨日／自定义、滚动返回、视窗高度变化、旋转、选择／图例、节点切换和 Tooltip。视窗模拟不等于操作实体 Safari 工具栏。短时间窗保留多个中间刻度；窄屏日期标签较宽时按实际容量避让，不只保留端点。空数据、0、部分／100% 丢包、null 与请求不变均有独立保护。

用户已确认当前 v2.8.4 安装包实际使用测试正常，并授权正式发布。此次反馈未逐项记录设备、浏览器版本及普通／私密／PWA 模式，因此不扩写为所有 iPhone Safari 场景均已验证；Playwright WebKit 仍仅作为引擎回归证据。

## 固定上游来源

- [Komari 1.5.1 Release](https://github.com/komari-monitor/komari/releases/tag/1.5.1)，commit `f0cc0fba38ce161935372633cae5248c934e2b23`。
- [fix1 → 1.5.1 完整差异](https://github.com/komari-monitor/komari/compare/1.5.0-fix1...1.5.1)：应用路由新增 `GET /admin` → 302 `/admin/dashboard`；其他变更位于构建工作流。
- [官方 Release workflow](https://github.com/komari-monitor/komari/blob/f0cc0fba38ce161935372633cae5248c934e2b23/.github/workflows/release.yml) 将 1.5.1／1.5.1-rc1 的前端来源固定为 `1.5.0-fix1`。Linux `--strip-all` 属于二进制构建参数，不是浏览器 API 变更。

未发现需要修改 Plus RPC、Metric／Legacy、缓存、调度、Header 跳转或内置 `admin-app` 的来源差异。是否兼容仍由真实发行二进制上的运行验证决定，不由源码差异替代。

| 上游变化                      | Plus 依赖点               | 影响与实际证据                                                            |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `/admin` → `/admin/dashboard` | Header 既有 `/admin` 入口 | 无需改动；1.5.1 返回 302，访客显示官方登录，管理员进入后台后可返回 Plus。 |
| 前端来源固定为 fix1           | 官方后台与同地址静态资源  | 官方固定二进制安装验证通过；不移植浮动前端，`/sw.js` 仍为 Plus 兼容文件。 |
| Linux `--strip-all`           | 主题导入、公开 RPC 与资源 | Linux 实际安装、历史图表和配置保存通过；无需主题 API／ZIP 格式适配。      |

## 可重复的发行验证

`tests/compatibility/releases.mjs` 固定官方 Linux／Windows amd64 二进制 SHA；`tests/compatibility/komari-releases.mjs` 用同一个候选 ZIP 依次测试 1.5.1、1.5.0-fix1、1.5.0、1.4.3。只在本机／CI 隔离目录初始化合成账号、节点和 Ping 数据，不连接生产站点。

门禁包括：真实同 short 的 v2.8.3 → v2.8.4 导入、全部安装文件字节一致、收藏／外观／绑定保留、实际 CPU 和非空 Ping 历史、两个图表入口与单／双图、HTTP／WebSocket、访客／管理员、配置保存与返回前台、1.5.1 `/admin` 302、资源 MIME 和 `/sw.js` 字节。

2026-09-25 使用同一份候选 ZIP，在官方 Linux 和 Windows amd64 发行物上完成下列运行验证；并非四次打包，也不是只检查 HTTP 200。

| 固定后端   | Linux | Windows | 本轮级别                                                                                                          |
| ---------- | ----- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| 1.5.1      | 通过  | 通过    | 真实导入及 v2.8.3 升级、节点／CPU、两入口 Ping 历史与开关、HTTP／WebSocket、登录身份／保存／返回、资源与 Worker。 |
| 1.5.0-fix1 | 通过  | 通过    | 同包直接对照，覆盖相同功能矩阵。                                                                                  |
| 1.5.0      | 通过  | 通过    | 同包安装／升级与配置、图表、传输保护 smoke；未重复完整视觉套件。                                                  |
| 1.4.3      | 通过  | 通过    | 同包安装／升级与配置、图表、传输保护 smoke；未重复完整视觉套件。                                                  |

Windows 1.5.1 与 fix1 另用真实 Header 按钮验证访客进入官方登录、合成账号通过 UI 登录、已登入管理员进入 dashboard 与返回 Plus；不是路由 mock。测试使用隔离 SQLite，没有连接生产数据库或验证 PostgreSQL 专项部署。

官方后端会批次写入合成 Ping。测试先等待真实历史可查询才打开浏览器，防止测试自身提前缓存空结果；不修改产品缓存或后端写入。旧版详细验证仍保留于 [1.5.0／fix1 历史记录](komari-1.5.md)。

最终发行来源为 `445bf02d0d58c0a8656e38faab79de30f213ed1a`，Bun 1.3.14、冻结 lockfile，并重新执行正式构建与 `release:prepare`。它相对产品候选 `59533c65c56ddcdb72bad933419f58ac299672d2` 只改测试、CI 和文档，生产运行输入没有变化。Linux 验证后的 ZIP 与排除本机开发 `.env` 的 Windows 干净构建，全部 768 个安装文件字节一致，且与产品候选的运行 payload 相同；同一最终 ZIP 随后再次通过 Windows 四版本矩阵、真实 Header 登入往返与结构／CRC／资源闭包校验。开发 `.env` 已原样还原且不进入快照或安装包。

- 安装包：`Glassmorphism-Plus-release-2.8.4.zip`，7,645,644 bytes。
- SHA-256：`b044eefcd5df9124cdbb40061a9fab704c172142ac88df7cbf5d22930ba9c6a1`，本地与 GitHub 回下载一致。
- [官方 Linux 同包矩阵](https://github.com/VoyagerProbe/Glassmorphism-Plus/actions/runs/36104178695)。

## 发布与回归结果

[v2.8.4](https://github.com/VoyagerProbe/Glassmorphism-Plus/releases/tag/v2.8.4) 已经用户实际测试并正式晋升 Stable／Latest。晋升前后重新下载的安装包 SHA-256 均为上列值，asset ID `587771193`、大小与全部内容保持不变；本次不重建、不替换资产、不移动 tag。上一候选完整 Chromium 的既有 NodeCard 连续空槽测试曾首次失败、重试后通过，未据此发布；原始失败证据保留，没有改写成无重试通过。

测试 fixture 已补充确定性同步：每次推进暂停的时钟后，等待本次触发的 RPC 完成、既有 Vue 刷新状态收敛及 DOM 提交，再读取 bucket；不等待未来周期 timer，不改变产品判定或放宽原断言。受控暂停响应的契约测试证明旧 helper 会提前返回，新 helper 不会额外推进时钟。原六槽测试连续 20 次、相邻测试 9 项均首次通过，零重试。

最终提交的[完整视图回归](https://github.com/VoyagerProbe/Glassmorphism-Plus/actions/runs/36104178709)为 Chromium 303／303、Tooltip 定向 3／3；WebKit 时间轴 12／12、原 Tooltip 7／7、标签与页脚 11／11、Header 16／16，均首次通过，0 failure／0 retry／0 skip。[Code Quality](https://github.com/VoyagerProbe/Glassmorphism-Plus/actions/runs/36104178821)、[真实 Worker 迁移与升级](https://github.com/VoyagerProbe/Glassmorphism-Plus/actions/runs/36104178692)和官方 Linux 矩阵均在同一提交首次成功。正式晋升前再次核对同一生产提交的 CI、敏感资料与安装包；发布收尾仅同步文档，不改变上述生产质量证据。

## 不变边界

Worker SHA-256 保持 `472d42cd35619cde31ba3378b3c1b1ed12a7687152e37b7d131b67902814d527`，无独立恢复页。继续采用[既有在线访问合同](service-worker.md)，不恢复官方离线外壳或运行时缓存，不新增注册／代理／全站清理。

v2.8.4 已为 Stable／Latest；核验时官方市场目录仍为 v2.8.3，等待正常自动更新周期及 PR 合并，详见[市场记录](../theme-market.md)。旧资产、主题 short、英文简介、LICENSE、原作者预览图及用户授权的 README 图片均保持。
