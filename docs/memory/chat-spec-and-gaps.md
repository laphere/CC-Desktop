---
name: chat-spec-and-gaps
description: 对话层行为规格与 B1–B16 待补齐清单在 docs/chat-behavior-spec.md（v2.0.0 删除时抢救出来的唯一副本）
metadata: 
  node_type: memory
  type: project
  originSessionId: 7e61a808-217e-4991-a7f8-e899651f0bed
  modified: 2026-09-21T09:50:02.292Z
---

`claude-fast-electron` 的 `docs/chat-behavior-spec.md`（2026-09-21 立）是**对话层规格的唯一副本**——§1 抄自已删除的 `v2.0.0` 的 CLAUDE.md（`app 内直接对话` / 会话页二合一 / `validate_resume_path` 的 Windows 与 macOS 口径），§2 是逐条对照审计出的本分支缺口 **B1–B16**，§3 是可翻成 vitest 的回归用例。

**为什么要记**：v2.0.0 一删，这段规格就没有第二份了（`main`/`v1.0.0` 的 CLAUDE.md 没有对话层）。

**How to apply**：动 `electron/backend/chat.ts` / `sessions.ts` / `platform.ts` / `ChatView.tsx` 之前先看它。**B1–B7 已于 2026-09-21 全部修复**（token 统计 / 同 id 消息合并 / Windows 拒字符 / 启动路径校验 / mac 脚本转义 / 关会话优雅退出窗口 / 本机 claude 定位与缓存）；**剩 B8–B16 未修**（权限与图片白名单、`chat_start` 会话校验、stderr、时间戳兼容等纵深防御，优先级见文档 §2 末尾），另有一条已知遗留：找不到本机 CLI 时的回退只写主进程日志、UI 不提示。

**一条订正**：`usage` 的代表行**取收尾行（带 `stop_reason`）**，不是 v2 记的「取首行」——实测首行 usage 恒为 0，取首行只有真实值的 1.3%。这条口径与用量台账共用 `usage-stats.ts` 的 `betterUsageRow`，两处必须同源。

相关：[[branch-sync-convention]]、[[agent-sdk-sidecar-evaluated]]、[[session-search-deferred]]
