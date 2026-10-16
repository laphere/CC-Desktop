---
name: v2-goal-gui-chat
description: v2.0.0 的产品目标 = 页面内 GUI 对话（该目标已在 claude-fast-electron 用 Agent SDK 实现；v2.0.0 分支 2026-09-21 删除）
metadata: 
  node_type: memory
  type: project
  originSessionId: 13980860-dad8-4f14-982d-e87531954e47
  modified: 2026-09-21T09:13:31.002Z
---

> **结局（2026-09-21）**：这个目标改由 `claude-fast-electron` 用官方 Agent SDK 实现，`v2.0.0` 分支已删除（见 [[branch-sync-convention]]）。下面记的是当时的取舍理由——「不要内嵌终端」这条**只适用于 GUI 对话分支**，别套到 electron 主线上（主线将来是否上终端是另一个决定）。

**`v2.0.0` 的目标是页面内 GUI 对话**（用户 2026-09-20 明说）：在 app 里自建聊天界面与 claude 交互（`chat.rs` 托管 claude 的 stream-json 子进程 + `ChatView.tsx` 自渲染）。**v2.0.0 不需要内嵌终端**——那是 `v1.0.0` 的路线，两支各走各的会话交互层。

**Why**：v1.0.0 选「嵌真终端」（PTY + xterm.js），理由见 [[embedded-terminal-plan]] ——自建 UI 永远是 CLI 交互面的影子，权限确认/plan 选择/斜杠补全/Shift+Tab/图片粘贴每版 claude 都要追。用户知情后仍决定 v2.0.0 走 GUI 自建路线，这是有意的产品取舍，不是待修的技术债——**不要再提议「v2.0.0 也上终端」或把终端合进 v2.0.0**。

**How to apply**：v1.0.0 → v2.0.0 的移植**要跳过终端相关改动**（v1.0.0 现含 `pty.rs`/`TerminalPane.tsx`/`src/lib/{pty,bold-bright,term-unicode,term-title}.ts` + xterm 依赖）。

**已知代价（用户知情）**：两支的 `App.tsx` 现在各有一套 tab 体系（v1.0.0 = 终端 pane tab，v2.0.0 = `ChatTabs` 对话 tab），而 App.tsx 是高频改动文件——**共享层（顶栏/侧栏/搜索/列表/对话框）的任何改动在移植时都会与 tab 相关的上下文冲突**，需要人工解。相关：[[branch-sync-convention]]
