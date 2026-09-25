# v2.8.4：Ping 时间轴与 Komari 1.5.1

## 时间轴根因与最小修复

两个入口共用 `src/components/PingChart.vue`。锁定 ECharts 6.1.0、vue-echarts 8.0.1；既有 `replaceMerge` 已正确移除多余 grid、xAxis、yAxis、series，`autoresize` 的实际尺寸也与容器一致。

旧版在 390px 的首页弹窗和详情页中，关闭丢包图后均出现可见时间标签相交。排除 Tooltip／axisPointer 后，实际模型仅一组轴，单图输入没有 `axisLabel.hideOverlap`，双图则明确启用了该项。因此只在基础时间轴补充 `hideOverlap: true`，保留既有布局、字号、time 轴、时间边界与更新策略，不重建图表、不重采样。

`tests/visual/ping-axis-layout.spec.ts` 分别观察 Vue 输入、有效 ECharts 模型及轴视图的实际 Text 边界，并保留 Canvas 截图。它覆盖 360／390px、桌面、两个入口、同实例十次切换、初始单图对照、1h／12h／跨日／自定义、旋转、选择／图例、节点切换和 Tooltip。短时间窗保留多个中间刻度；窄屏日期标签较宽时按实际容量避让，不只保留端点。空数据、0、部分／100% 丢包、null 与请求不变均有独立保护。

Playwright WebKit 是引擎回归，不是用户原 iPhone Safari；本轮原设备实际操作仍待用户验证。

## 固定上游来源

- [Komari 1.5.1 Release](https://github.com/komari-monitor/komari/releases/tag/1.5.1)，commit `f0cc0fba38ce161935372633cae5248c934e2b23`。
- [fix1 → 1.5.1 完整差异](https://github.com/komari-monitor/komari/compare/1.5.0-fix1...1.5.1)：应用路由新增 `GET /admin` → 302 `/admin/dashboard`；其他变更位于构建工作流。
- [官方 Release workflow](https://github.com/komari-monitor/komari/blob/f0cc0fba38ce161935372633cae5248c934e2b23/.github/workflows/release.yml) 将 1.5.1／1.5.1-rc1 的前端来源固定为 `1.5.0-fix1`。Linux `--strip-all` 属于二进制构建参数，不是浏览器 API 变更。

未发现需要修改 Plus RPC、Metric／Legacy、缓存、调度、Header 跳转或内置 `admin-app` 的来源差异。是否兼容仍由真实发行二进制上的运行验证决定，不由源码差异替代。

## 可重复的发行验证

`tests/compatibility/releases.mjs` 固定官方 Linux／Windows amd64 二进制 SHA；`tests/compatibility/komari-releases.mjs` 用同一个候选 ZIP 依次测试 1.5.1、1.5.0-fix1、1.5.0、1.4.3。只在本机／CI 隔离目录初始化合成账号、节点和 Ping 数据，不连接生产站点。

门禁包括：真实同 short 的 v2.8.3 → v2.8.4 导入、全部安装文件字节一致、收藏／外观／绑定保留、实际 CPU 和非空 Ping 历史、两个图表入口与单／双图、HTTP／WebSocket、访客／管理员、配置保存与返回前台、1.5.1 `/admin` 302、资源 MIME 和 `/sw.js` 字节。

首次提交时该发行矩阵仍待最终 CI 与候选包验证；通过后补充实际结果。旧版详细验证是历史记录，见 [1.5.0／fix1](komari-1.5.md)，不把历史结果冒充本次运行。

## 不变边界

Worker SHA-256 保持 `472d42cd35619cde31ba3378b3c1b1ed12a7687152e37b7d131b67902814d527`，无独立恢复页。继续采用[既有在线访问合同](service-worker.md)，不恢复官方离线外壳或运行时缓存，不新增注册／代理／全站清理。

版本只新增 v2.8.4 Pre-release，稳定 Latest 与市场安装版本继续 v2.8.3。旧资产、主题 short、英文简介、LICENSE、原作者预览图及用户授权的 README 图片均保持。
