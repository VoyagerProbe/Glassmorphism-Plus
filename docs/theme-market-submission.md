# Komari Theme Market Issue Form 填写资料

检查日期：2026-09-20。以下内容仅供用户本人填写，Codex 未提交任何官方 Issue 或 PR。

## 提交前状态

**暂时不要提交。** 当前 v2.8.2 的结构、元数据、下载及预览校验通过，但实际 Release ZIP 未附带上游 LICENSE。未来打包流程已修正；当前资产没有替换。建议先由维护者决定后续修正版，完成测试并转为正式 Latest 后再提交，版本号不由本任务决定。

当前官方表单只有两个输入字段和一项必选确认，没有单独填写版本、short、SHA-256 或安装包地址的字段；它们由官方自动化读取。依据：[官方表单](https://github.com/komari-monitor/theme-market/blob/667e7a7177eddac5a04383c0d45325a807da2b32/.github/ISSUE_TEMPLATE/submit-github-theme.yml)。实际提交时请再确认表单未更新。

## 按表单顺序填写

Issue 类型：**提交在 GitHub 中开源的主题**

Title（模板默认前缀为 `[Theme] `）：

```text
[Theme] Komari Glassmorphism Plus
```

### GitHub 仓库地址 / GitHub repository URL

```text
https://github.com/VoyagerProbe/Glassmorphism-Plus
```

### 预览图链接 / Preview image URL

```text
https://raw.githubusercontent.com/VoyagerProbe/Glassmorphism-Plus/main/docs/preview.png
```

### 我已确保 / I confirm

官方唯一确认项：

> 仓库必须公开，且最新 Release 中必须提供可下载的主题包。 / The repository must be public and provide a downloadable theme package in its latest Release.

☑ 本次已核验该技术条件：仓库公开，正式 Latest v2.8.2 提供可下载安装包。此处仅是核验结果，不代表已代用户勾选或提交表单，也不代表许可证缺口已在现有资产中解决。后续修正版发布后，用户提交前应再次核对并亲自勾选。

## 用户本人操作

1. 先决定后续修正版的发布安排；本次不建立新版本、不移动 tag、不替换当前安装包。
2. 后续版本仍先以 Pre-release 提供；完成实际测试后，由用户手动转为正式 Latest，并核验唯一安装 ZIP 含原始 LICENSE。
3. 打开[官方 GitHub 开源主题表单](https://github.com/komari-monitor/theme-market/issues/new?template=submit-github-theme.yml)，填写以上标题、仓库和图片地址。
4. 核对条件，亲自勾选并点击 Submit；等待官方校验、自动生成的 PR 及维护者审核。PR 合并、目录实际出现本仓库后，才能称为已上架。

检查时未发现本仓库的现有提交。不要把同名 [Issue #104](https://github.com/komari-monitor/theme-market/issues/104) 当作本项目：它填写的是 `towersip/komari-theme-Glassmorphism`，因为 `short=Glassmorphism` 已存在而关闭，不是 `VoyagerProbe/Glassmorphism-Plus`。
