# Change Log

All notable changes to the "deepseek-comment-translate" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Fixed
 - 目标语言被写死：`translate()` 解构了 `to` 却从未使用，提示词硬编码 `translate from en to zh-Hans`，导致主插件切换目标语言无效。现在会读取真实的目标/源语言
 - 多行注释译文行数与原文不一致时，主插件会丢弃整段译文。新增行数对齐，并在首轮不符时自动重试一次
 - 请求参数：`max_tokens` 由 1000 提升到 4096（避免长注释被截断）；移除 `frequency_penalty` / `presence_penalty`（为 1 时会惩罚重复 token，对翻译有害）
 - axios 未设置超时，网络异常时 hover 会一直挂起。现限制为 60s
 - 修改任意配置都会立即发起一次真实 API 请求，现改为 800ms 防抖

### Changed
 - 默认模型由已废弃的 `deepseek-chat` 改为 `deepseek-flash`（注意：`deepseek-v4.1-flash` 不是有效模型名，API 会返回 HTTP 400）
 - 移除源码中零引用的 `querystring` 依赖

### Added
 - 单元测试 `npm run test:unit`：35 个用例，覆盖语言解析、提示词构建、行数对齐，以及用桩替换 `vscode`/`axios` 后的请求报文与重试逻辑


## [1.0.2] 2025-1-2
### Add
 - Fork from `kitiho/vscode-comment-translate-chatgpt:master`
 - Change the model from `chatgpt` to `deepseek`
