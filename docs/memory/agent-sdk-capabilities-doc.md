---
name: agent-sdk-capabilities-doc
description: 要动对话层 / 加 SDK 能力前，先读 docs/agent-sdk-capabilities.md（能力总表 + 型实标注 + 探针清单）
metadata: 
  node_type: memory
  type: reference
  originSessionId: 643c8f36-34b3-4ff9-937e-746a9505a41d
  modified: 2026-09-21T20:17:56.985Z
---

`docs/agent-sdk-capabilities.md`（2026-09-22 整理）是 Agent SDK 能力面的索引：`Options` 68 个开关 / `Query` 28 个方法 / `SDKMessage` 39 种事件 / 五个入口 / 会话文件 API，每条标了 **实**（本仓跑过）还是 **型**（只看了 `sdk.d.ts`，用前要先跑探针）。目的是不必重读 9451 行 d.ts。

**Why:** 对话层原先只用到 `Options` 的 6 项 + `Query` 的 3 个方法，而能力散在 d.ts 里没有索引。「预热子进程」「查上下文占用」「热切模型」「结构化输出」「进程内自定义工具 / 子代理」这些都在，一个都没用。

**How to apply:** 接新能力前先翻它，尤其 §7 的「没用但值得排队」表和 §9 的「采用前先跑探针」清单——**标 `型` 的别直接落地**，本仓踩过的坑基本都长在「类型上写着、运行时不是那么回事」上（`resolvePermissionModeInCli`、`updatedInput.answers` 都是这么发现的）。

2026-09-22 这次会话复验并补进去的（原先标 `型`）：

- §6.11 `getContextUsage()` **可用** —— `categories[kind==='used']` 求和作分子、`maxTokens` 作分母即得占用率；**`percentage` 字段的单位仍没验**，所以对话层不转发它。
- §8 新增三条：**`system/init` 要等第一条用户消息才到**（所以「一启动就显示」必须主动问，不能挂在 `session_ready` 事件上）；**`init.effort` 在 SDK 宿主上拿不到，且全 SDK 没有读取接口**（只有 `Options.effort` 可写、hook 输入、`CLAUDE_EFFORT` 环境变量三处有它）；**`Query.interrupt()` 是无参的，够不着 CLI 的 `cancel_queued`**（只能读回执里的 `still_queued` 判断"没停干净"）。

相关：[[chat-readability-tuning]]（同一会话的另一半）、[[chat-spec-and-gaps]]。
