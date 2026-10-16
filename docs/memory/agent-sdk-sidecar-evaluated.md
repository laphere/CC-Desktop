---
name: agent-sdk-sidecar-evaluated
description: 2026-09-20 评估「Node sidecar + @anthropic-ai/claude-agent-sdk」方案，结论不采用；chat.rs 已是等价的手写客户端
metadata: 
  node_type: memory
  type: project
  originSessionId: ca71ba12-1f75-4498-a364-b184ffadd17b
  modified: 2026-09-21T09:13:34.903Z
---

2026-09-20 评估了 v2.0.0 的一个方案：后端挂 Node sidecar 跑 `@anthropic-ai/claude-agent-sdk`，用它的 permissionMode / canUseTool / ExitPlanMode 审批。**结论：不采用。**

核实到的决定性事实：

- **SDK 是 CLI 的包装层，不是 API 客户端。** `query()` 内部 spawn `claude` 子进程走 stdio NDJSON，control subtype 就是 `initialize` / `can_use_tool` / `hook_callback` / `mcp_message` / `interrupt` / `set_permission_mode`——与 `src-tauri/src/chat.rs` 现在收发的是同一套。spawn flag 一一对应（`--include-partial-messages` = `includePartialMessages`、`--input-format stream-json` = 双向流、`pathToClaudeCodeExecutable` = `resolve_claude_exe`）。
- **没有 in-process 库**；官方 hosting 文档给非 Node 宿主的模型就是「一个会话 = 一个 CLI 子进程 + stdio 协议」，社区 Rust 移植的调用行几乎逐字等于 `build_cli_args`。所以「官方 GUI 正道」这个前提对本仓库不成立。
- **ExitPlanMode 没有专用 API**，就是走 `canUseTool('ExitPlanMode', {plan})`：批准 `{behavior:'allow'}`、改后再批准 `updatedInput.plan`、拒绝留在 plan 模式。
- 代价：Tauri 里变成 sidecar 套 sidecar（打包坑 `spawn node ENOENT`，Electron 侧已验证）；SDK 把版本钉在自带 CLI 上，失去「跟用户本机同一个 claude」；`settingSources` 默认 `[]` **不加载** settings.json（拿不到 `permissions.defaultMode`）/ CLAUDE.md，与现设计刻意继承 settings 的行为冲突。
- 净新增只有：in-process MCP bridge、hook 回调、session 管理 API（fork/list/SessionStore）、typed 面。真要上 SDK，`claude-fast-electron` 分支（后端本是 Node/TS）是零边际运行时成本的宿主。

**Why:** 方案把「canUseTool 弹批准 + ExitPlanMode 审批」当卖点，但这两块仓库已实现（`translate_control_request` + `build_permission_response`）；真缺的只是 ExitPlanMode 的**触发**——现在是 `turn_end && mode==="plan"` 的启发式（`ChatView.tsx`）＋批准时发合成用户消息＋`plan_structure` 侧信道 LLM 调用。

**How to apply:** 再提这个方向时，直接建议在 Rust 里补 `translate_control_request` 的 `tool_name == "ExitPlanMode"` 分支（新 `PlanApproval` 事件 → 复用现有方案卡 → allow/deny），并给 `build_permission_response` 加 `updatedInput` 支持；**并且必须给 `build_cli_args` 加 `--permission-prompt-tool stdio`，否则交互类工具压根不进工具表**（见 [[exitplanmode-needs-permission-prompt-tool]]——我最初漏了这条，误判成「原生方案审批是死代码」）。附带发现：权限判定顺序是 `PreToolUse hook → deny → allow → ask → permission mode → canUseTool → PostToolUse`，**canUseTool 只是 ask 路径**，自动批准（acceptEdits/bypassPermissions/白名单）的调用根本不到它——要做通用闸门得用 PreToolUse hook。

**后续（2026-09-21）**：上面的「How to apply」已无对处——`v2.0.0` 分支当天删除。落到 `claude-fast-electron`（本就 Node/TS）的 SDK 方案里，「补 Rust 的 ExitPlanMode 分支」这一步不需要了；真正要留意的坑变成 SDK 侧的两条：`canUseTool` 必须回 `updatedInput.answers`（AskUserQuestion）与 `resolvePermissionModeInCli`，见 `docs/agent-sdk-interactive-tools.md`。

相关：[[v2-goal-gui-chat]]、[[branch-sync-convention]]、[[chat-spec-and-gaps]]
