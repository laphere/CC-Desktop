---
name: session-search-deferred
description: 会话搜索（项目内）已完整设计但用户决定暂缓实施；复活条件与设计文档位置
metadata: 
  node_type: memory
  type: project
  originSessionId: 05d7b451-a72f-4312-a76c-edae3c71073e
  modified: 2026-10-16T05:05:08.202Z
---

2026-09-18：用户裁定 A1「会话搜索」**先不做**——用的过程中确认是刚需再启动（找回会话频繁失败、或某次找不到造成实际损失、或统计期4会话下钻先做了）。

**Why:** 设计已收敛（两轮 UI 迭代 + PM 评审均完成），但当前使用强度撑不起优先级；用户偏好「刚需验证后再投入」，同类先例见 [[branch-sync-convention]] 的克制风格。

**How to apply:** 若用户再提「找会话/搜会话」，不要从零设计——完整方案、否决备选、PM 评审待办（P0 键盘路径、P1 扫描进度兜底）和实现锚点都在 `docs/session-search-plan.md`；交互原型在 `docs/session-search-prototype.html`（自包含，浏览器直开）。设计要点一句话版：项目右键菜单「搜索会话」→ 搜索框按需出现在会话块首行 → 标题即时过滤 + 异步全文原地合并 → 命中行片段高亮 → 点击走既有 jumpTo 跳转；后端主体是逐文件复用 `search_session_messages_impl`（lib.rs:1702）。

**2026-10-16 订正**：本条说的是**项目内跨会话搜索**，它确实仍未实施（项目右键菜单里没有「搜索会话」）。别与已落地的**会话页内搜索**混淆——那是 ChatView 顶部搜索按钮做的单会话全文搜索（命中跨分页跳转，后端在 `electron/backend/session-extra.ts`）。另：上文 `search_session_messages_impl（lib.rs:1702）` 是已删除的 v2.0.0 Rust 实现，复活本需求时参考本机 tag `v2.0.0-final` 或 session-extra.ts 的现行实现。
