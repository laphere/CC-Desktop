---
name: exitplanmode-needs-permission-prompt-tool
description: ExitPlanMode/AskUserQuestion 在 --print 下要加 --permission-prompt-tool stdio 才进工具表；SDK 传 canUseTool 会自动补
metadata: 
  node_type: memory
  type: project
  originSessionId: ca71ba12-1f75-4498-a364-b184ffadd17b
  modified: 2026-09-20T16:20:12.202Z
---

2026-09-21 复验，**订正此前一条错结论**：`--print` 模式下交互类工具（`ExitPlanMode` / `AskUserQuestion` / `EnterPlanMode` / `DesignSync`）默认不在工具表里，但**加 `--permission-prompt-tool stdio` 即恢复**。实测对照（同参数、`--permission-mode plan`）：

```
基线（无该 flag）                工具数=28  命中=[]
--permission-prompts host       工具数=28  命中=[]
--permission-prompt-tool stdio  工具数=31  命中=[ExitPlanMode, AskUserQuestion, EnterPlanMode]
```

**Why 之前判错**：2026-09-20 我只试了 CLI help 里那条 **`--permission-prompts host`**（复数，是另一条 flag），而 help 文字里已经写着正主是 `--permission-prompt-tool`，我没顺着查下去。据此得出的「print 模式拿不到 ExitPlanMode、原生方案审批永远是死代码」是**错的**，并导致我把 Tauri 分支已经写好的原生方案审批降级成了兜底触发（`turn_end && 计划模式`）。实际只需给 `build_cli_args` 加一对参数 + UI。教训：**结论是「某能力不可用」之前，先把 help 里提到的相关 flag 逐个试过**。

**How to apply**：SDK 侧不用管——只要传了 `canUseTool`，SDK 会自动补这个 flag（`sdk.mjs` transport 的 `initialize()`）；裸协议侧要自己加。另外两个坑：① 工具总数会因 MCP/插件工具加载在 24–31 间抖动，**别拿总数当判据**，要直接查具体工具名；② `--input-format stream-json` 下 init 事件要等第一条 stdin 消息才吐，不发消息只等 init 会一直静默（别误判成卡死）。可复用探针在 `%TEMP%\plan-probe\`（`pptool.mjs` 就是这次的对照脚本）。

相关：[[agent-sdk-sidecar-evaluated]]、[[v2-goal-gui-chat]]
