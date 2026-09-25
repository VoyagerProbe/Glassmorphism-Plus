# Komari 官方 Theme Market 检查报告

## 当前状态补充（2026-09-25）

只读核对目录 commit `1bee29cf00729f6ceb59fbec756a9807e28a33bc`：唯一 `glassmorphism-plus` 条目已更新为 v2.8.3，下载地址与 SHA-256 对应现有稳定包。简介仍是原市场文案；本轮不修改官方目录、Issue、PR 或 workflow。v2.8.4 保持 Pre-release，不作为市场 Latest 自动升级目标。下方旧状态保留为历史核验记录。

## 当前状态补充（2026-09-21）

已只读核对正式目录 commit `9608c03aaceff433e4bbd99df3acfba23fe3035b`：本主题已收录，唯一标识 `glassmorphism-plus`，仓库 `VoyagerProbe/Glassmorphism-Plus`，目录版本仍为 2.8.2。**不要重复首次提交。** 下文 2026-09-20 的结论保留为当时审计记录，不代表当前收录状态。

v2.8.3 已正式晋升 Stable／Latest，沿用最终 Header Tooltip 修复包，不重建、不替换资产、不移动 tag。唯一安装包 `Glassmorphism-Plus-release-2.8.3.zip` 的 asset ID 为 `578850324`、大小为 7,645,587 bytes；晋升前后实际下载 SHA-256 均为 `5f2395ef9dad6aa4280d951d60692200f712cf16eec9485c4f4b684f5d03541b`，结构、manifest、LICENSE 与兼容 Worker 校验通过。市场仍为 v2.8.2，本轮未修改其历史资产或官方目录。

当前[自动更新脚本](https://github.com/komari-monitor/theme-market/blob/9608c03aaceff433e4bbd99df3acfba23fe3035b/scripts/update-theme-releases.mjs)读取正式 Latest，只写入 `version`、`download`、`sha256`，支持唯一版本化 ZIP 回退，不同步 `description` 或 `preview`。[官方 workflow](https://github.com/komari-monitor/theme-market/blob/9608c03aaceff433e4bbd99df3acfba23fe3035b/.github/workflows/update-theme-releases.yml)约每六小时运行，创建／更新 PR 后仍需合并；本次核验时现有自动更新 [PR #103](https://github.com/komari-monitor/theme-market/pull/103) 尚未包含 Plus v2.8.3，市场目录不能视为已更新。

已针对现有条目只读执行该版本官方 `updateTheme` 决策函数：旧资产名在新 tag 下返回 404，随后唯一 v2.8.3 ZIP 返回 200；真实下载的 manifest short 精确匹配 `glassmorphism-plus`、version 为 `2.8.3`、SHA 与正式包一致。仅在本地内存中产生版本／下载／校验值更新，确认具备自动更新输入条件，没有写入官方目录或触发 workflow。

README 首页预览换图仅影响文档，市场 preview 继续使用原 `docs/preview.png` URL。新简介的人工更新资料见[市场跟进](theme-market-submission.md)。本轮没有向官方市场写入、提交 Issue／PR 或触发 workflow；下文历史审计保持原状。

Komari 1.5.0-fix1 实际后台的设置按钮使用 `settings.theme` 传入 `theme.settings_with_name`；manifest 的 `name` 与 `configuration.name` 不控制此按钮。为保持升级身份，按钮仍为 `glassmorphism-plus设置`，未添加显示字段、注入脚本或修改官方后台。

---

检查日期：2026-09-20。官方仓库检查基线：`667e7a7177eddac5a04383c0d45325a807da2b32`。这是上架准备，不是新版本发布，也不是已上架声明。

## 1. 最终结论

**暂时不要提交。** 当前公开仓库、正式 Latest、唯一安装 ZIP、manifest、short 和原版预览图符合本次核对的官方技术校验条件，但已发布 ZIP 缺少原始 LICENSE／copyright／permission notice。当前已发布安装包没有包含 LICENSE，建议下一个版本修复。

未来打包及校验已修复，现有 v2.8.2 Release、tag、资产、版本号、产品功能和图片未修改。维护者决定后续发布安排后，再更新本报告的发行物事实并提交。官方校验脚本不检查 LICENSE；技术校验通过不能代替分发许可检查。

## 2. 官方规则检查结果

实际执行逻辑优先于概括性文档：

| 项目          | 本次核对的规则                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 首次提交      | GitHub Issue Form：仓库 URL、预览图 URL、一项确认；opened/reopened 或维护者手动重处理触发校验                                        |
| 仓库／Release | 查询仓库信息及 `/releases/latest`；不从 main 构建，不接受表单指定 tag                                                                |
| ZIP 选择      | 遍历 Release 的 `.zip` 自定义 assets，必须恰有一个通过结构校验的主题包；零个或多个有效包都会拒绝；自动源码归档不在 assets 中         |
| 下载大小      | ZIP 最大 100 MiB；预览图最大 10 MiB；最多 10 次重定向；公开 HTTP(S)，拒绝 URL 用户信息及解析到非公网地址的下载地址                   |
| 解压安全      | 最多 10,000 个 entries（含目录）；单文件最大 128 MiB；解压文件总计最大 512 MiB；拒绝路径穿越、绝对／盘符路径、反斜杠、NUL 和 symlink |
| manifest      | 根目录恰有一个 `komari-theme.json`，最大 1 MiB，JSON 对象；name/short/version/author 为非空字符串；description 为字符串或空值        |
| short         | `[A-Za-z0-9_-]+`，不为 `default`；目录按大小写不敏感规则查重，同时拒绝重复项目 URL、下载 URL                                         |
| version       | 首次脚本仅要求非空字符串，不强制 SemVer，也不验证它等于 tag；本项目额外核对 `v2.8.2` ↔ `2.8.2`                                       |
| preview       | PNG/JPEG/GIF/WebP/AVIF 的内容签名；表单使用绝对 URL，包内 `preview` 保持相对路径；本项目另验证 PNG 解码与像素尺寸                    |
| SHA-256       | 对实际下载 ZIP 的完整字节计算小写 SHA-256；不是源码包或重新构建包的摘要                                                              |
| 收录结果      | 校验成功后自动创建上架 PR，不等于已收录；合并后以官方 catalog 为准                                                                   |

来源：[提交脚本](https://github.com/komari-monitor/theme-market/blob/667e7a7177eddac5a04383c0d45325a807da2b32/scripts/theme_submission.py)、[提交 workflow](https://github.com/komari-monitor/theme-market/blob/667e7a7177eddac5a04383c0d45325a807da2b32/.github/workflows/process-theme-submission.yml)、[排序校验](https://github.com/komari-monitor/theme-market/blob/667e7a7177eddac5a04383c0d45325a807da2b32/scripts/check-catalog-order.mjs)。

### 文档与脚本差异

- [主题开发文档](https://komari-document.pages.dev/dev/theme)及市场 README 允许 name/description/author 多语言对象；首次提交脚本目前仍要求字符串。本项目继续使用字符串，不改成对象。
- 开发文档概括为提交 PR；当前市场 README 和 workflow 已提供 Issue Form → 自动 PR 流程。本项目按表单准备，用户本人提交。
- 市场 README 概括“版本与 SHA-256 校验”；实际更新脚本只要求 version 存在、short 精确相同，重新计算 SHA，而不是校验 SemVer 必须递增或对比发布者签名。首次提交的资源／安全限额也没有完整复用到后续更新脚本，不能把首次严格校验误说成每次自动更新均具备。

## 3. 当前项目状态

- 仓库：[VoyagerProbe/Glassmorphism-Plus](https://github.com/VoyagerProbe/Glassmorphism-Plus)，GitHub API 确认 Public，未归档；分支 `main`。
- 审计起点 HEAD：`f06e2b0c57152d4a052bf8af79a013723736e9bd`，工作区干净，远端与本地一致；本次只推送后续打包／文档修正。
- manifest：`name=Komari Glassmorphism Plus`、`version=2.8.2`、`short=glassmorphism-plus`、`author=VoyagerProbe`、`url=https://github.com/VoyagerProbe/Glassmorphism-Plus`、`preview=preview.png`。
- JSON 无 BOM，字段类型正确；`configuration.type=managed`，61 个配置项保持原样，未发现需要为市场删除的废弃字段或缺少的必需字段。
- 官方 catalog 共 49 项，未出现本仓库／short；全量检查 107 个 Issue/PR 条目并搜索 URL、仓库名、short，未发现本项目重复提交。
- 同名 [Issue #104](https://github.com/komari-monitor/theme-market/issues/104)属于其他仓库，因 `short=Glassmorphism` 冲突而失败关闭。搜索另返回的 [PR #63](https://github.com/komari-monitor/theme-market/pull/63)是已合并的批量更新，涉及原版 Glassmorphism，不是本 Plus 仓库。

## 4. Preview 检查

| 项目       | 结果                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| 仓库文件   | `docs/preview.png`，保持原图，未编辑／压缩                                                             |
| 市场 URL   | https://raw.githubusercontent.com/VoyagerProbe/Glassmorphism-Plus/main/docs/preview.png                |
| HTTP／类型 | 匿名 GET 200；`Content-Type: image/png`；无重定向，不需 Cookie 或 GitHub Token                         |
| 内容       | PNG magic `89504e470d0a1a0a`，IHDR／解码验证通过；不是 HTML、403／Cloudflare 页面、JSON 或 LFS pointer |
| 像素／大小 | 1280 × 720；740,647 bytes                                                                              |
| SHA-256    | `a4d81c3d52c35f7793f643b309459c93f86c1fe1d922b09373d82df2b6b12222`                                     |
| 三方比较   | 本地 docs、匿名 Raw 下载件、Release ZIP 内 preview.png 完全一致                                        |
| 上游比较   | 与上游当前 `06999d5a77ebe521a02fd3e383e67a064e345e7e` 和参考 v3.3.7 的原图均完全一致                   |

授权检查：仓库整体 MIT 文本和既有 attribution 保留；图片独立来源有待进一步确认。上游 LICENSE 实际版权人为 `Copyright (c) 2025 Tony Liu (tonyliuzj, tony-liu.com)`，并非将版权重写为 sanrokamlan 或 VoyagerProbe。sanrokamlan 是原项目维护者，VoyagerProbe 是 Plus 维护者，三者角色没有混同。

**未发现单独的图片授权说明，目前依据上游仓库整体许可证和现有来源说明使用。** 未发现 preview 的单独第三方来源证明，也没有证据支持声称“原作者明确授权 VoyagerProbe”。MIT 允许复制／分发，但要求保留原版权及许可文本；当前源代码仓库的 LICENSE/CREDITS/UPSTREAM 已保留，安装 ZIP 有缺口。来源：[上游 LICENSE](https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism/blob/06999d5a77ebe521a02fd3e383e67a064e345e7e/LICENSE)、[本项目 CREDITS](../CREDITS.md)、[UPSTREAM](../UPSTREAM.md)。

## 5. Release 检查

| 项目                                 | 当前值                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| main manifest／最新 tag              | 2.8.2／v2.8.2                                                                  |
| 最新创建／最新发布／最新正式 Release | 均为 v2.8.2                                                                    |
| 最新 Pre-release                     | v2.3.1，历史状态保留；没有待晋升的 v2.8.2                                      |
| `/releases/latest`／页面 Latest      | v2.8.2／是                                                                     |
| 标题／tag                            | v2.8.2／v2.8.2                                                                 |
| draft／prerelease                    | false／false                                                                   |
| created_at／published_at             | 2026-09-20T12:10:51Z／2026-09-20T05:29:45Z（API 原值，不把它们误认为同一时间） |
| target_commitish                     | `main`（最终发行源码以实际 tag peeled commit 为准）                            |
| tag peeled commit                    | `30ca2748b7ffbd7cfd35106c15854f61bbae7259`                                     |
| tag object                           | `a756cbb9960ec47641524ed512bfc04c9e2f1480`                                     |
| Release／asset ID                    | 392323266／576753914                                                           |

已读取全部 25 个 Release，而不是从 README 推断。main 的后续文档提交不改变 tag 对应产品源码。Release 页面和 API 的 Latest 均确认；GitHub `/latest` 返回非 Draft、非 Pre-release 的最新正式 Release，不等于 main HEAD、最高 tag 或最新创建的任意预发布。依据：[GitHub API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)、[本版 Release](https://github.com/VoyagerProbe/Glassmorphism-Plus/releases/tag/v2.8.2)。

## 6. Installer 检查

- 唯一自定义 asset：`Glassmorphism-Plus-release-2.8.2.zip`。
- 从 API 的真实 `browser_download_url` 匿名下载：[安装包](https://github.com/VoyagerProbe/Glassmorphism-Plus/releases/download/v2.8.2/Glassmorphism-Plus-release-2.8.2.zip)。一次正常 HTTPS 跳转到 `release-assets.githubusercontent.com`，最终 HTTP 200。
- 实际 GitHub Release asset：**7,644,897 bytes**，SHA-256 **`622ac4455b2d674886380dda6219b1dc5442703d8a1a24145cb29d20d4363b08`**；与本地保留的正式 ZIP 和 API digest 一致，不是本次重新构建的候选包摘要。
- 776 entries／767 文件，解压合计 13,738,213 bytes；最大单文件 2,031,522 bytes；最高条目压缩比约 19.78；manifest 14,342 bytes，均低于官方限额。
- 解压前检查通过：无路径穿越／绝对路径／盘符／symlink／加密／重复路径／重复 manifest；解压后逐项长度和 CRC 通过。
- 根目录恰为 `komari-theme.json`、`preview.png`、`dist/`；`dist/index.html` 存在，ZIP manifest 与当前 main manifest 完全一致。
- 静态资源闭包检查 1,266 个 HTML、CSS、ESM／动态 import、import.meta.url 及图标引用，无缺失。Web App Manifest 是 `dist/admin-app/manifest.json`，不与 Komari manifest 混同；没有更改它。
- 未发现源码／测试／node_modules／Git／本机路径、凭据或调试资料。扫描中的 8 个既有压缩后台公共字面量按原哈希复核，不是真实凭据。
- **许可证 notice：有缺口。** ZIP 无 LICENSE/NOTICE/COPYING，也未找到原版权声明。不能用仓库根目录有 LICENSE 代替安装包随附文本。

## 7. 未来 Theme Market 自动更新

来源：[更新脚本](https://github.com/komari-monitor/theme-market/blob/667e7a7177eddac5a04383c0d45325a807da2b32/scripts/update-theme-releases.mjs)、[定时 workflow](https://github.com/komari-monitor/theme-market/blob/667e7a7177eddac5a04383c0d45325a807da2b32/.github/workflows/update-theme-releases.yml)。

1. 已有 catalog 条目必须有 GitHub 项目 URL、download、sha256，并能从 download 提取原 tag 与 asset 名。
2. 查询 `/releases/latest`，通过 GitHub 该端点排除 Draft／Pre-release；脚本没有再次独立检查这两个布尔字段。
3. 最新 tag 与 catalog 下载 URL 中 tag 相同则立即跳过，因此**同一 tag 下换 ZIP 不会被该脚本追踪**。本项目继续采用用户批准的新版本流程。
4. 先尝试“最新 tag + 旧 asset 名”的构造 URL，再尝试最新 Release 同名 asset 的实际下载 URL；没有同名 asset 且最新 Release 只有一个 ZIP 时，回退到这个 ZIP 的实际 URL。
5. 因此 `Glassmorphism-Plus-release-X.Y.Z.zip` 的版本化名称可继续使用；不要增加第二个 ZIP。首次提交多个有效 ZIP 会拒绝；后续没有同名、又有多个 ZIP 时无法可靠回退，可能不更新。
6. 下载成功后读取根 manifest，要求 short 与 catalog 精确相等、version 存在；没有 SemVer 递增比较，也没有 tag/version 相等检查。SHA 从实际 ZIP 重新计算，不是校验发布者签名。
7. 仅自动更新 `version`、`download`、`sha256`，并调整 catalog `updated_at`／排序；不自动同步 name、description、author、url、preview、short。
8. cron 为 `17 */6 * * *`：UTC 00:17、06:17、12:17、18:17（台北 08:17、14:17、20:17、次日 02:17），GitHub 调度可能延迟；也支持官方维护者手动运行。
9. 变化通过 `bot/update-theme-releases` 分支创建／更新 PR；当前 workflow 没有自动合并步骤。本次没有操作官方 workflow、分支或 catalog。

## 8. 本次修改

- `vite.config.ts`：未来安装包附带原样 LICENSE；缺失或非普通文件时拒绝打包。
- `scripts/prepare-release.ts`：LICENSE 纳入必需输入及逐字节摘要校验。
- `scripts/test-installer-license.ts`：有效、缺失、等长篡改、重复 LICENSE、源 LICENSE 缺失五个用例；`--built` 额外检查实际构建包。
- `.github/workflows/quality.yml`：既有 build 后加入上述定向检查，不更改发布触发或 Pre-release 规则。
- `README.md`：仅补充未来 LICENSE 结构、当前已发布包缺口、市场准备文档入口。
- 本检查报告及[用户填写资料](theme-market-submission.md)。

未修改版本／manifest／short、产品源码／UI／Worker、图片、依赖／lockfile、LICENSE 原文、CREDITS／UPSTREAM 或任何历史 Release。没有生成本项目市场 `v1.json`。官方只读快照和临时审计文件均在正式源码／publish／release 目录之外，不提交。

## 9. 已执行验证

- 官方 `inspect_theme_package`、`validate_preview_image` 直接校验实际下载字节；`process_github_submission` 使用本次真实 API／下载输入回放，通过；`add_theme_to_catalog` 仅在内存验证查重，未写 catalog。不是官方 Action 已执行／接受的声明。
- `node scripts/check-catalog-order.mjs` 在官方只读快照检查现有 49 项排序，无 `--write`。
- PNG 解码、三方及上游哈希、ZIP 元数据／CRC／安全解压、静态资源闭包、实际候选／staged 文件隐私扫描。
- `bun scripts/test-installer-license.ts`：五项通过；定向 ESLint：通过。
- `bun run build`：包含 type-check，通过；`bun scripts/test-installer-license.ts --built`：实际候选 768 文件及 LICENSE 校验通过。首次构建尝试被沙箱目录读取限制阻止，授权重试后完成；保留日志，没有隐瞒。既有大 chunk 提醒保留，未为消除警告修改产品。
- 下载的正式包与仅供本地审计的候选包，分别安装到真实官方 **Windows Komari 1.5.0-fix1** 临时实例、隔离 Chromium context；首页 Vue 挂载、HTML 对应、JS/CSS 200 与 MIME、无启动异常／同源失败／404 均通过。未连接生产服务，未声称本轮做过 Linux 或实体 Safari 测试。
- 本次候选仅验证未来打包规则，不提供给用户安装、不上传、不替换正式资产。构建前后原本地正式 ZIP 和原 dist 均已保留／恢复；正式 ZIP SHA 不变。
- 仅打包／文档变更，不额外手动运行完整视觉或多浏览器矩阵。正常 main push 的既有 CI 仍按原配置触发；未跳过、修改重试或弱化断言。

## 10. Issue Form 填写资料

见[可复制资料](theme-market-submission.md)，严格对应当前官方字段。Codex 未提交任何官方 Issue 或 PR，也未代用户勾选。

## 11. 用户本人下一步

先决定后续修正版的发布安排；新版本仍先 Pre-release → 实际测试 → 用户手动正式 Latest。确认唯一安装 ZIP 带原始 LICENSE 后，再按表单资料本人提交，等待官方校验和 PR 合并。本任务没有擅自选择版本号。

## 12. 阻塞项

1. 当前 v2.8.2 实际 Release 安装包未随附许可证通知；本次只修复未来流程，需另行发布授权才能交付修正版。
2. 预览图未找到单独图片授权／原创来源证明，保留上游整体 MIT 与现有归属说明使用的证据边界，不虚构个别授权。

除以上披露外，本次没有发现官方结构／元数据／图片下载／short 冲突导致的技术提交障碍。准备完成、正式发行和市场收录是三个独立状态。
