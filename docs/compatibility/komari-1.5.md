# Komari 1.5.0 / 1.5.0-fix1 兼容验证

> 本文保留最初适配轮的测试事实。其后 v2.8.2 已进入同版本启动／Worker 兼容修复；下文的“不接管 Worker／没有修改 public”是历史范围，不代表当前候选实现。当前运行合同与 Safari 验证状态见[启动兼容说明](service-worker.md)。

v2.8.2 是兼容验证维护版，不是默认前端移植。先用最终 v2.8.1 安装包建立 A/B 基线，再验证同一 v2.8.2 候选安装包。本轮没有修改 `src/`、`public/`、产品配置默认值、依赖、构建流程或后台压缩包；生产输入仅更新主题版本。

## 固定来源

测试使用官方原始 Windows amd64 发行二进制，不从当前浮动分支重建。各二进制 SHA-256 与 GitHub asset digest 核对一致。

| Komari tag | 后端完整 commit                            | 官方二进制 SHA-256                                                 |
| :--------- | :----------------------------------------- | :----------------------------------------------------------------- |
| 1.4.3      | `bf6b45ec3abfc56bba5e9223650a47a72f665371` | `459839e1cd4e07d674f246f4b409163d24277d2eb23accaf0ab73cfb10861a49` |
| 1.5.0      | `f18ad72c173b8821711cba0f2fb238c2486ec9af` | `a440e7a5ac7386d9da7f87be619fb827783ee20425b34539e7455efc9869c308` |
| 1.5.0-fix1 | `0ca87aafd184ed75f9030ede0902772142af5eec` | `afe1277a5ae451807ba64c999515737e735bca5b39e9b9162d10d249c709e23c` |

官方构建另行取得 komari-web。fix1 的构建日志明确使用前端 `1.5.0` tag、commit `dec649518a769882308ab80794c633bf6bfc265b`；原 1.5.0 构建使用当时默认分支，日志未提供足够信息确认前端完整 SHA，因此以原发行二进制实际服务的 HTML／JS／Worker bytes 为依据，不冒称可由今天的默认分支重现。

实际入口为 1.5.0 的 `entry-index-C3FswyLj.js` 和 fix1 的 `entry-index-p5pT4dr8.js`。它们不是同一份前端 bytes；两份实际 Worker 都包含 root／instance／admin 导航 allowlist，不能仅凭 fix1 的 Go 通知删除提交推断 PWA 行为。

## 差异与最小处理

| 上游字段／入口                                                          | Plus 实际调用点                                 | 三版本观察                                                                                 | 处理                                         |
| :---------------------------------------------------------------------- | :---------------------------------------------- | :----------------------------------------------------------------------------------------- | :------------------------------------------- |
| `/api/rpc2` 与公开节点／任务                                            | `utils/rpc.ts`、nodes store、现有 Ping services | HTTP／WebSocket 均能读取；Agent v1 删除不影响浏览器 API                                    | 保持既有读取与 fallback                      |
| `common:getRecords`、`public:queryMetrics`、`public:getPingMetricStats` | 历史服务、Ping 双图／小型时间桶                 | 非空负载与 Ping 历史；RFC3339 时间、字符串 task ID；Metric loss 为 0–1，统计 loss 为百分数 | 增加合成契约测试，不改算法                   |
| `gpu`、GPU 可选元数据                                                   | `nodes.ts` 的现有 `status.gpu` 映射             | 1.4.3 最新 `gpu` 为后端旧值 0；1.5.0／fix1 返回上报平均值，并附设备信息                    | 后端自身修复；保留真实 0，不改映射或添加补查 |
| 内置流量定时通知移除                                                    | Plus 无被删除通知方法／路由的调用               | 流量、实时速率与累计数据仍可用                                                             | 无需生产修改                                 |
| zstd 内置资源                                                           | 正常 theme 分块上传与静态资源服务               | 第三方 ZIP 导入契约仍有效                                                                  | 保持原 ZIP 格式和 `preview.png`              |
| `/admin`、`/terminal`                                                   | 现有后台入口                                    | 由后端默认前端提供，非 Plus UI                                                             | 不移植后台、不修改 `admin-app`               |
| 官方 SW 导航缓存                                                        | Plus 启动前的导航                               | 见下面独立矩阵                                                                             | 上游限制；不接管 Worker                      |

公开备注继续仅使用 `public_remark`，不回退私有备注或 Token。三个隔离后端均验证访客看不到 hidden 节点／私有备注、管理员能看 hidden 节点、登录退出及私有站点拒绝；HTTP 401／管理 RPC 权限错误没有被当作空数据成功。

## 实装范围与 PWA 条件

| 场景                                                           | 1.4.3                                | 1.5.0                   | 1.5.0-fix1                                  |
| :------------------------------------------------------------- | :----------------------------------- | :---------------------- | :------------------------------------------ |
| 全新浏览器、无官方 Worker                                      | 首页／详情／返回／完整 Ping 弹窗正常 | 正常                    | 正常                                        |
| 公开节点、CPU／流量／备注、任务归属、离线节点                  | 通过                                 | 通过                    | 通过                                        |
| Metric／Legacy 非空历史与真实 0／部分／100% 丢包               | 通过                                 | 通过                    | 通过                                        |
| HTTP 默认／WebSocket 基本连接                                  | 通过                                 | 通过                    | 通过                                        |
| Plus 管理界面保存并重载 Ping 配置                              | 通过                                 | 通过                    | 通过                                        |
| 同 short 上传候选 ZIP、配置保留、资源内容类型                  | 通过                                 | 通过                    | 通过                                        |
| 先访问官方默认主题形成 Worker，再同 origin 切换 Plus、普通刷新 | 本次样本加载 Plus；不推及所有旧缓存  | 仍可能返回默认主题 HTML | 仍可能返回默认主题 HTML                     |
| 保留原 1.5.0 浏览器状态、同 origin 升级到 fix1                 | 不适用                               | 升级前基线              | root／instance／pingsettings 仍被旧状态拦截 |
| WebKit 手机仿真：双图、Tooltip 轻点／长内容滚动、弹窗／导航    | 未重复实装                           | 未重复实装              | 通过；非实体 iPhone 惯性滚动证明            |

PWA 测试 B/C 复用同一 context、origin 和浏览器状态，记录 controller、scriptURL／scope、导航来源及实际入口资源；没有硬刷新、禁用缓存、注销 Worker 或清空站点数据。受控导航显示 `fromServiceWorker=true`，Plus bootstrap 尚未执行，故不能由 Plus 启动脚本安全解决。普通 JSON-RPC 请求仍返回 JSON；问题不是将 Agent 接口误当浏览器 API。

该限制必须与“全新浏览器普通浏览已验证”分开理解。fix1 Release 声明的 PWA 修复不代表本次实际发行包对所有旧缓存路径都已修复；本版不作无条件 PWA 升级保证。

### 旧 PWA 故障排查

如果升级后仍显示默认主题，先检查当前页面是否被官方 `/sw.js` 控制、导航是否来自 Worker，并对照服务器直接返回的主题 HTML。可用独立浏览器资料做诊断对照，但这不是旧资料已修复的证据。优先关注上游修复；如站点管理员决定人工处理缓存，应先记录偏好和绑定设置，只针对已确认的官方 Worker／缓存按浏览器文档操作，不把“清除所有站点数据”作为默认升级步骤。本主题不自动执行这些动作。

## 依赖、回归与未验证范围

- Bun 固定 `1.3.14`；原 `bun.lock` SHA-256 为 `6182cf1206cb55897391ad6f51327dd756aac0343bb8d44a25c122cf2119ceea`。直接与传递依赖不变，CI 保留干净 `--frozen-lockfile` 安装及安装后未改写检查。
- 增加 5 项状态／Metric 契约保护：旧版缺省、新版 GPU、真实零值、可选 null／空数组，以及时间与丢包比例。既有完整 Visual Regression 和 WebKit 触控 job 保留，没有过滤、skip、断言弱化或截图基线更新。
- 真后端使用隔离 SQLite、合成节点、15 项 Ping 任务及正常 API 上报／配置。未连接生产服务器或数据库，原始响应、会话和审计日志不进入源码或安装包。
- 不声称全部数据库、全部 1.5.x、所有反代／HTTPS／PWA 安装形态、实体手机、真实 GPU 硬件或长达 30 天的真实服务器留存均已实测；相应既有算法回归不等同于这些环境实装。

## 官方来源

- [Komari 1.5.0](https://github.com/komari-monitor/komari/releases/tag/1.5.0)、[1.5.0-fix1](https://github.com/komari-monitor/komari/releases/tag/1.5.0-fix1)、[GPU 修复 #672](https://github.com/komari-monitor/komari/pull/672)。
- [固定 fix1 路由](https://github.com/komari-monitor/komari/blob/0ca87aafd184ed75f9030ede0902772142af5eec/web/router/router.go)、[静态资源](https://github.com/komari-monitor/komari/blob/f18ad72c173b8821711cba0f2fb238c2486ec9af/web/public/public.go)、[主题导入](https://github.com/komari-monitor/komari/blob/f18ad72c173b8821711cba0f2fb238c2486ec9af/web/api/admin/theme.go)。
- [前端构建](https://github.com/komari-monitor/komari/blob/f18ad72c173b8821711cba0f2fb238c2486ec9af/.github/actions/build-frontend/action.yml)、[发行构建](https://github.com/komari-monitor/komari/blob/f18ad72c173b8821711cba0f2fb238c2486ec9af/.github/workflows/release.yml)、[固定前端 PWA 配置](https://github.com/komari-monitor/komari-web/blob/dec649518a769882308ab80794c633bf6bfc265b/vite.config.ts)。
