---
name: askquestion-stream-closed
description: AskUserQuestion 报「Stream closed」的排查结论与待验假设（2026-09-22 首现，未定案）
metadata: 
  node_type: memory
  type: project
  originSessionId: 14faea11-e06a-4e9b-899d-273f5f6b43f5
  modified: 2026-09-22T06:19:48.870Z
---

2026-09-22 用户在 app 内跑计划模式演练时，`AskUserQuestion` 两次失败；2026-09-22 当天复跑**未复现**（卡片正常弹出、选项/取消/键盘提示都对）。**结论未定案**，只立了边界。

## 已实测排除（探针在 `%TEMP%\ask-probe\`，不进源码库）

- `probe.mjs` / `probe3.mjs`：宿主**故意不应答**提问，挂满 60s / 70s，CLI **不超时、不报错**（单轮字符串 prompt 与 app 同款「流式输入 + includePartialMessages + resolvePermissionModeInCli」两种配置都试）。→ 那次「22 秒后报错」不是超时。
- `probe2.mjs`：提问挂起时调 `query.interrupt()`，报的是 `The user doesn't want to proceed with this tool use…`，**不是** `Stream closed`；中断后会出现新的 `system init`。
- 「答案 key 不匹配」是另一句错（`The user did not answer the questions.`），与本问题无关。
- `probe4.mjs`（提问挂起期间发 `getContextUsage`/`setPermissionMode`）**没跑成**，用户中途取消——下次可直接复跑。

## 那些错误串的含义（都在 `claude.exe` 内，不在 SDK 里）

`Tool permission request failed: AbortError: Tool permission stream closed before response received` / `AbortError: Stream closed`
= **CLI 等宿主回话的那条流被关掉了**。之后同一进程里再发权限请求会**瞬间**失败（`Stream closed`）——进程"半死"但仍活着。

## 出事会话的时间线（`~/.claude/projects/D--MyWorkspaces-myProject-public/31ab39cb-…jsonl`）

提问 96.4s 发出 → **118.6s** 第一条错（+22.2s）→ 121.5s 模型自动重试 → **122.6s** 瞬间第二条错 → 294.8s 出现 `Continue from where you left off.`（**新进程 `--resume`** 的标志）。第 3 次提问能正常弹卡是在恢复后的进程里。

## 待验假设（下次出现时先打这个）

app 里唯一会结束这条流的是 `close()` 的 `queue.end()`，触发者 = **ChatView 卸载 → `chatClose`**（关 tab / 关窗口 / 退出 app / 删会话的 kill 注册表）。假定那次是「**提问卡还挂着时那个 tab 被关了**」：close 关了流但**子进程没被杀干净**（所以 122.6s 还能调模型、权限请求必失败）。

**How to apply:** 用户再报这个错时，① 先读出事会话 jsonl 尾部，确认是不是同款「一条 22s 后的错 + 一条瞬时错」；② 让他**在提问卡挂着时关掉那个 tab**（再试关窗口/退出 app，都走同一个 `queue.end()`），复现即坐实；③ 若关 tab 试不出来，下一个怀疑对象是「`--resume` 起来的进程 + 提问」组合。相关：[[chat-spec-and-gaps]]、[[agent-sdk-capabilities-doc]]
