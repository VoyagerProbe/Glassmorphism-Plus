<div align="center">

# 🌌 Komari Glassmorphism Plus

面向 Komari Monitor 的增强玻璃拟态主题，重点强化每节点 Ping 任务绑定、长时间历史、性能、移动端体验和日常运维能力。

![Version](https://img.shields.io/github/v/release/VoyagerProbe/Glassmorphism-Plus?style=for-the-badge&label=release&color=10b981)
![Vue](https://img.shields.io/badge/Vue-3-42b883?style=for-the-badge&logo=vue.js)
![Vite](https://img.shields.io/badge/Vite-7-646cff?style=for-the-badge&logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-v4-38bdf8?style=for-the-badge&logo=tailwindcss)
![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-000000?style=for-the-badge&logo=bun)
![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)

**[功能概览](#-功能概览)** ·
**[安装与升级](#-安装与升级)** ·
**[兼容性](#-兼容性)** ·
**[本地开发](#️-本地开发)** ·
**[版本历史](CHANGELOG.md)**

</div>

---

## 🚦 项目状态

| 项目               | 当前状态                                                                                                               |
| :----------------- | :--------------------------------------------------------------------------------------------------------------------- |
| 当前 Plus 版本     | **v2.8.0**（预发布／Pre-release）                                                                                       |
| 上游同步基线       | [sanrokamlan Glassmorphism v3.3.7](https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism/releases/tag/v3.3.7) |
| 当前维护者         | [VoyagerProbe](https://github.com/VoyagerProbe)                                                                        |
| 适用平台           | [Komari Monitor](https://github.com/komari-monitor/komari)                                                             |
| 已验证 Komari 版本 | **1.4.3**                                                                                                              |
| 技术栈             | Vue 3、TypeScript、Vite 7、Tailwind CSS 4、Pinia、ECharts、Bun                                                         |
| 源码发布           | GitHub `main` 与 `v2.8.0` Pre-release；附加唯一、已验证的客户安装包                                                     |
| 本地安装包         | `2.8.0/Glassmorphism-Plus-release-2.8.0.zip`                                                                           |

Glassmorphism Plus 是独立维护的 Glassmorphism 衍生主题，Plus 使用自己的版本体系；上游 v3.3.7 仅代表当前同步基线，并非 Plus 的版本号。同步来源、选择性合并和署名详见 [UPSTREAM.md](UPSTREAM.md)。

### ✨ 最新版本 · v2.8.0（预发布）

- 节点详情页新增丢包历史图，与延迟图共享任务选择、时间范围、底部图例和时间参考线。
- 新增默认开启的“丢包数据”按钮，关闭恢复单延迟图；首页 Ping 弹窗保持原有布局。
- 双图使用同一时间点的提示框，分别展示延迟与丢包；保留真实 0%、部分丢包、100% 丢包与数据空缺。
- 沿用现有 Ping 查询、缓存、调度与延迟处理；丢包图不参与峰值平滑，不从统计摘要或旧接口延迟猜测丢包。

---

## 📸 预览

### 首页与三网监控

[![Glassmorphism Plus 首页与三网监控预览](https://cdn.nodeimage.com/i/EGIqdmhrJ8Bqz25PQ1TP4gyITnpaVc8v.png)](https://cdn.nodeimage.com/i/EGIqdmhrJ8Bqz25PQ1TP4gyITnpaVc8v.png)

<details>
<summary><strong>查看延迟监测中心：任务配置与任务概览</strong></summary>

### 延迟任务配置

[![Glassmorphism Plus 延迟任务配置预览](https://cdn.nodeimage.com/i/smXmmmmP89tYoBsGYnHnnHtXrLHisDxw.png)](https://cdn.nodeimage.com/i/smXmmmmP89tYoBsGYnHnnHtXrLHisDxw.png)

### 延迟任务概览

[![Glassmorphism Plus 延迟任务概览预览](https://cdn.nodeimage.com/i/Tah3jwF2c6RkVIg0EJBflMeUi2a91XPF.png)](https://cdn.nodeimage.com/i/Tah3jwF2c6RkVIg0EJBflMeUi2a91XPF.png)

</details>

*点击图片可查看原图，具体界面以当前版本为准。*

---

## ✨ 功能概览

保留原版 Glassmorphism 的玻璃拟态界面与节点展示能力，重点增强每节点 Ping 任务配置、三网监控和日常浏览体验。

- **节点监控**：支持卡片与列表视图，查看 CPU、内存、磁盘、流量及运行状态；提供多尺寸卡片、分组、搜索与收藏。
- **延迟与丢包**：每台节点可独立选择已分配的 Ping 任务；支持单任务或三网监控，并分别展示延迟与丢包趋势，区分等待采样、无采样和探测不可达。
- **统一任务管理**：在“延迟监测中心”查看任务覆盖情况，支持全局默认、单节点配置和多节点批量配置，配置保存仅限管理员。
- **详情与历史图表**：查看节点硬件、系统信息和历史指标；Ping 支持1小时至30天及自定义范围、平滑峰值，同一节点切换时间范围时保留任务选择。
- **外观与移动端**：支持浅色、深色、北京时间自动模式，以及地球／地图、自定义背景与布局；兼顾电脑和手机浏览。
- **费用与辅助工具**：查看节点费用、剩余价值与到期提醒，提供节点对比、健康摘要和视图导出，并支持配置访客可见内容。

*历史数据的实际可查看范围取决于后端保留时间及已有采样记录。*

原版主题由 sanrokamlan 开发，Plus 由 VoyagerProbe 继续维护。来源与致谢见 [UPSTREAM.md](UPSTREAM.md) 和 [CREDITS.md](CREDITS.md)。

---

## 📦 安装与升级

正式源码仓库：<https://github.com/VoyagerProbe/Glassmorphism-Plus>

### 重要说明

- **v2.8.0 GitHub Pre-release 附加且只附加一个已验证的 installer asset：** `Glassmorphism-Plus-release-2.8.0.zip`。
- 当前 Latest 为 v2.7.4。其他预发布版本请从对应版本页面手动下载安装包测试。
- GitHub 自动生成的 **Source code (zip)** 是源码快照，**不是** Komari 可安装主题包。
- Komari 的远程仓库导入流程应使用正式 Release 中的 installer asset；仍不要用 GitHub 自动生成的源码压缩包代替。

### 方式一：本地生成安装包

Windows、macOS 或 Linux 安装 Node.js 与 Bun 后，在项目根目录执行：

```bash
bun install --frozen-lockfile
bun run lint
bun run type-check
bun run build
bun run release:prepare
```

`bun run build` 会在源码目录的上一级创建客户安装 ZIP：

```text
<version>/Glassmorphism-Plus-release-<version>.zip
```

安装 ZIP 根目录直接包含：

```text
komari-theme.json
preview.png
dist/
```

随后在 Komari 后台进入“主题管理 → 上传主题”，选择该 ZIP 并启用 **Komari Glassmorphism Plus**。

### 方式二：使用 GitHub Release 安装包

从对应版本的 [GitHub Release](https://github.com/VoyagerProbe/Glassmorphism-Plus/releases) 下载 `Glassmorphism-Plus-release-<version>.zip`，核对版本与发布记录后可直接在 Komari 后台上传。不要用 GitHub 的 Source code zip 代替。

### 升级提示

- 升级前记录当前 managed theme 设置，尤其是每节点 Ping 任务绑定。
- v1.x 的单任务绑定会自动兼容为 v2 的一任务配置，原始 v1 key 不会被重写或删除。
- 上传新 ZIP 后确认站点名称、首页布局、`pingsettings`、节点详情和 Ping 长范围数据。
- Komari 后台显示的主题版本取自根目录 [`komari-theme.json`](komari-theme.json) 的 `version`。

---

## 🧩 兼容性

| Komari 版本     | 状态            | 说明                                                                                      |
| :-------------- | :-------------- | :---------------------------------------------------------------------------------------- |
| **1.4.3**       | **Verified**    | 本项目当前主要实机与回归目标。Metric Store、每节点 Ping 绑定和历史查询已验证。            |
| **1.2.6–1.4.2** | **Best effort** | 保留能力检测与 Legacy fallback，但没有对每个中间版本执行完整回归矩阵。                    |
| **1.2.5**       | **Not tested**  | 保留旧 records／Ping fallback；该版本缺少当前主要 `queryMetrics` 能力，不作完整兼容承诺。 |

兼容状态描述的是当前测试证据，不等同于对整个 `1.2.x` 系列的统一保证。部署到未验证版本前，请先在测试环境检查首页、节点详情、Ping、累计流量和管理页面。

---

## 🛠️ 本地开发

```bash
bun install --frozen-lockfile
bun run dev
bun run type-check
bun run lint
bun run build
bun run test:visual
bun run release:prepare
```

- `bun run lint` 会使用 ESLint `--fix`，执行后应检查 diff。
- `bun run test:visual`／`bun run test:webkit` 会先做不产出 installer 的测试构建，再运行 Playwright；除非有明确视觉变更，不要更新基准快照。
- `bun run build` 才执行正式 production build 与版本化 Komari installer 打包，避免测试覆盖历史版本产物。
- 首次运行浏览器测试可能需要 `bunx playwright install chromium`。
- `bun run release:prepare` 会验证 `bun run build` 已生成的客户安装 ZIP，并建立过滤后的本地 release snapshot；两者都不得加入 Git。正式发布默认将这一个已验证 ZIP 上传为唯一自定义 Release asset，随后从 Release 回下载并复核 SHA-256、结构与 manifest。

源码边界与 AI 开发规则见 [AGENTS.md](AGENTS.md)；前端目录规则见 [src/AGENTS.md](src/AGENTS.md)。

---

## 📝 版本历史

当前版本更新见上方「最新版本 · v2.8.0（预发布）」。

<details>
<summary><strong>📚 查看历史版本更新</strong></summary>

<br>

### v2.7.4

- 优化节点详情页顶部响应式布局，长节点名称和服务商名称不再挤压节点切换控件。
- 移动端将节点切换器与服务商信息分行；PC 端将服务商归入身份区，切换器稳定右对齐。
- 修复 Ping 图表切换时间范围后任务选择重置的问题，同一节点内保留选择，切换节点后重新初始化。
- 保持节点数据读取、Ping 查询、缓存、调度和图表计算行为不变。

### v2.7.3

- 将当前维护者与项目链接统一更新为 VoyagerProbe，页脚版本署名简化为“版本号 · VoyagerProbe”。
- 修复 Ping 任务统计提示在深浅主题下的文字对比度，并保持全部统计内容与交互。
- 修复首页列表进入节点详情时，已显示的 Ping 趋势条在离场阶段短暂清空的问题。
- 保持现有数据读取、缓存、刷新与任务配置行为不变。

### v2.7.2

- 首页所有节点与任务现在同步显示同一最新三分钟时间槽；尚无真实样本的当前槽以“等待采样”呈现，不再因透明样式看似少一格。
- `WAITING_SAMPLE` 使用 v2.6.0 的中性灰占位；成功查询确认的 `NO_SAMPLE` 使用 v2.7.1 原延迟不可达红色斜纹；真实 `latency=null + loss=100%` 的 `UNREACHABLE` 延迟与丢包两轨统一为现有实心故障红。
- 等待采样、无采样、探测不可达、更新失败与任务失效保持独立语义；bucket Tooltip 与 ARIA 同步，迟到真实样本仍可原位恢复为数据或不可达。
- 本版不改动 Ping RPC、请求参数、Metric／Legacy、缓存、共享调度、三分钟 20 bucket 几何、任务绑定或长范围图表行为。

### v2.7.1

- 将成功查询后仍为空的已结束 Ping bucket 明确收敛为“无采样”，保持延迟／丢包空值且不参与平均，并与真实 100% 丢包状态区分。
- 当前采集桶与写入宽限期内的刚关闭桶继续等待；迟到真实样本仍可原位恢复为正常数据或不可达。
- 移除首页 Header 工具按钮重复的自定义 Tooltip，保留原生 `title`、`aria-label` 与键盘操作。
- 访客端主题切换改为“浅色模式／北京时间自动／深色模式”三个直接按钮；北京时间自动继续采用 UTC+8 的既有昼夜规则。
- 保持 Ping RPC、请求、缓存、调度、任务绑定和三分钟 bucket 几何不变。

### v2.7.0

- 修复节点详情页与首页 Ping 弹窗右侧显示无数据时间段的问题。
- Ping 图表以当前可见任务的最新可用数据作为显示终点，不再预留明显空白尾部。
- 统一详情页与首页弹窗的时间域规则，同时保留真实缺口、自定义范围和长时间历史。
- 提高浅色主题下首页 NodeCard 及内部信息区的边框清晰度，深色主题保持不变。
- 保持 Ping 数据读取、缓存、刷新和任务绑定行为不变。

### v2.6.0

- 将公开页面文案统一为“延迟监测中心”“延迟任务概览”和“延迟任务配置”。
- 移除延迟任务概览卡片中冗余的延迟／丢包摘要，集中展示任务信息与覆盖关系。
- 覆盖节点改为带标题、节点总数和自动换行胶囊标签的有界列表，长列表可在区域内滚动。
- 保持首页 NodeCard、三网监控、Ping bucket、Tooltip、任务绑定、API／RPC 与指标读取逻辑不变。

### v2.5.0

- 统一首页 Ping 为固定 20 个三分钟时间区间，并同时展示固定区间与真实采样时间。
- 隐藏未完成采样格的交互与 Tooltip，避免把等待状态误作历史数据。
- 重构移动端价值与费用明细，并修复 Komari 1.4.x 生产环境 JSON-RPC 基址。
- 加强 RPC、网络与初始化错误分类，保持可选功能故障隔离。

### v2.3.1（预发布）

- 新增不可达 Ping 目标的独立严重故障状态。
- 明确区分完全断线与高延迟／部分丢包。
- 使用即时自定义 Tooltip 替代浏览器原生 Ping Tooltip。
- 优化三位数延迟与 100% 丢包的显示空间。
- Release 开始提供经过校验的客户安装 ZIP。

### v2.3.0（预发布）

- 优化 Ping 延迟与丢包颜色等级。
- 避免正常跨区域高延迟被错误显示为严重故障。
- 重构 NodeCard 延迟／丢包标签和趋势轨道。
- 优化不可达任务与 100% 丢包状态。
- 保持固定 20 格趋势布局。

### v2.2.0（预发布）

- 加粗并固定 Ping 延迟／丢包历史格尺寸。
- 修复数值、hover、focus 和 Tooltip 导致历史格变形。
- 优化 100% 丢包、不可达及异常状态。
- 改善三网监控开关布局、无障碍与草稿／保存交互。
- 简化单节点继承配置，移除重复入口。

### v2.1.0（预发布）

- 将首页 Ping 配置简化为单任务／三网监控。
- 优化三网节点卡片的延迟、丢包和状态展示。
- 改进 Ping 监控中心、筛选、单节点与批量配置。
- Ping 配置界面统一使用简体中文。
- 增加 v2.0 多任务设置兼容迁移。

### v2.0.0（预发布）

- 重构首页 Ping 数据读取、缓存与刷新流程。
- 首页节点卡支持最多三项 Ping 任务。
- 增加全局默认、单节点覆盖及批量服务器配置。
- 四种节点卡片尺寸适配多 Ping 布局。
- 自动兼容旧 v1.x 单任务绑定。

### v1.4.0

- 选择性同步上游 Glassmorphism v3.3.6 与 v3.3.7。
- 平铺地图遵循 Plus 的总览卡片选择和顺序。
- 累计上传／下载历史在降采样时保留计数器语义。
- 重整 Plus 版本、兼容性与上游署名文档。

### v1.3.6（预发布）

- 修复 Komari Metric Store 中 30 天 Ping 图表历史覆盖不完整。
- 增加感知数据留存周期的多层 Ping 历史合并。
- 保留真实缺口与原始样本，并加强 Komari 1.4.x 汇总兼容性。

### v1.3.5（预发布）

- 修复 30 天 Ping 范围被后端部分日级汇总压缩成约 7 天的问题。
- 防止断连边界的失败探测被平均成虚假低延迟。
- 保留 7／14 天范围、平滑峰值、每节点 Ping 绑定与运行指标行为。

### v1.3.4（预发布）

- 恢复模态视图和节点详情中的 Ping 峰值平滑控制。
- 增加 7 天与 14 天 Ping 图表范围。
- 修复 iPhone Safari 底部黑边与 safe-area 问题。
- 提升移动端 Ping 弹窗和图表稳定性。

### v1.3.3（预发布）

- 区分等待采样、真实数据与确认缺失状态。
- 支持迟到 Ping 数据自动回填。
- 改善 NodeCard 与详情页的数据同步、冷启动和无痕模式表现。
- 保留 100% 丢包、20 格趋势与每节点独立 Ping 任务语义。

### v1.3.2

- 调整 Ping 面板和移动端布局对齐。
- 稳定 NodeCard Ping 趋势条的几何和状态呈现。
- 统一版本化 publish、release snapshot 与客户安装包准备路径。

### v1.3.1

- 修正旧快照和不同任务缓存串用。
- 避免任务切换后显示过期 Ping 结果。
- 加强 managed theme 选择控件与卡片趋势条几何一致性。

### 1.3.0（预发布）

- 选择性同步上游 Glassmorphism v3.3.4 与 v3.3.5。
- 修复指定 Ping 任务 100% 丢包时错误回退聚合数据。
- 优化首页延迟／丢包加载、缓存与自动刷新。
- 统一 Ping 任务顺序，并继续完善每节点独立任务绑定。

### 1.2.1（预发布）

- 加入以节点 UUID 为中心的每节点 Ping 任务绑定。
- 候选任务按后端 `task.clients` 关系过滤。
- 首页按节点读取指定任务，并在绑定失效时回退原聚合数据。
- 改善数据加载速度和自动更新体验。

### 1.2（预发布）

- 这是 Glassmorphism Plus 的早期测试 Release。
- 在原版 Komari Glassmorphism 主题基础上继续开发。
- 保留对原作者 [sanrokamlan-prog](https://github.com/sanrokamlan-prog) 的署名。

</details>

完整版本记录请查看 [CHANGELOG.md](CHANGELOG.md) 与 [GitHub Releases](https://github.com/VoyagerProbe/Glassmorphism-Plus/releases)。上游来源与选择性同步记录见 [UPSTREAM.md](UPSTREAM.md)。

---

## 🙏 Credits & License

- Glassmorphism Plus 维护者：[VoyagerProbe](https://github.com/VoyagerProbe)
- 原始 Glassmorphism 主题与维护者：[sanrokamlan](https://github.com/sanrokamlan-prog)
- 原始仓库：[sanrokamlan-prog/komari-theme-Glassmorphism](https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism)
- License：[MIT](LICENSE)

详细贡献与版权边界见 [CREDITS.md](CREDITS.md)；上游同步策略见 [UPSTREAM.md](UPSTREAM.md)。原始 LICENSE 文本与版权声明保持不变。
