---
name: todo-sdk-and-review
description: 已记待办（2026-09-22 起）：用足 Agent SDK 的能力、全面代码审查含 macOS、健康检查一键安装 Claude Code；清单在 docs/todo.md
metadata: 
  node_type: memory
  type: project
  originSessionId: 94a49de1-b6b7-44ee-a6aa-59069ee1d9c3
  modified: 2026-09-22T14:15:56.373Z
---

2026-09-22 用户记下的待办，正文在 `docs/todo.md`（T1 / T2 / T3，后续可追加）：

- **T1 用足 Agent SDK 的能力**：功能增强 / 缺失补齐 / 替换手搓三类；候选清单与排序在 `docs/agent-sdk-capabilities.md` §7，采用前先跑 §9 的探针。
- **T2 全面代码审查（含 macOS 兼容性）**：重点是「双平台承诺 vs 只在 Windows 验过」的落差。
- **T3 健康检查一键安装 Claude Code**：未安装时弹窗只有红叉，补安装按钮；npm 兜底腿在 `buildUpgradeBat/Sh` 里现成，注意 npm 定位（没 claude 就没锚点）与按钮挂载条件（`currentError === "未找到 claude 命令"` 才算未安装）。

**Why:** 本项目一直单机 Windows 开发，`dist:mac` 从未真机跑过；而 SDK 的能力面（68 个 Options / 28 个 Query 方法）大面积没用，其中若干项正好能替掉现有手搓实现。

**How to apply:** 开工前先读 `docs/todo.md` 对应条目，别从零重设计。T2 有两处**代码里已实锤**的 Mac 缺口（不是猜测）：`clipboard-image.ts:46` 非 win32 恒 null（终端贴图在 mac 静默不可用）、`pty.ts:198` 非 win32 无杀树（孙进程可能存活）；另有 35 处 `win32` 分支待逐条判等价。T1 的两条纪律：标 `型` 的能力未实测、替换手搓前先对数字（`sessions.ts` 的合并与 usage 口径是自家实测出来的）。相关：[[agent-sdk-capabilities-doc]]、[[chat-spec-and-gaps]]。
