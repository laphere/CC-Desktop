---
name: terminal-port-to-electron
description: 内嵌终端迁移到 Electron 线（一个 app 两种模式）；已落地出货（2026-09-21 真机打包验证全过）；交接简报 docs/embedded-terminal-port-brief.md、spike 结论在 .workbuddy/terminal-port-spike/CONCLUSIONS.md
metadata: 
  node_type: memory
  type: project
  originSessionId: 7e61a808-217e-4991-a7f8-e899651f0bed
  modified: 2026-10-16T05:05:04.226Z
---

**目标**：把内嵌终端（现在活在 Tauri 的 `embedded-terminal` 分支）并进 Electron 主线，做成**一个 app 两种交互模式**（终端 pane + 页面内对话 pane），共享层从此只有一份。用户 2026-09-21 拍板的方向：设置里给「默认交互方式」，但**两种 tab 共存**。

**交接简报**：`docs/embedded-terminal-port-brief.md`（已提交在本分支）——自包含，给另一个会话用。**新会话先读它**，别从零设计。

**阶段 0 已过（2026-09-21）**：三处判定全绿，完整数据+复跑方法在 `.workbuddy/terminal-port-spike/CONCLUSIONS.md`（gitignored）。要点：① 字体/WebGL——Electron（Chromium 146）与 WebView2（153）度量逐值一致（行高 28/列宽 14.0/0 暗缝/中文 24.5×24/bold 224:204），**取值零重标定**（阴性对照 DOM 渲染器 32 缝证明量法敏感）；② IME 六步断言全过、xterm 私有字段全部可达（真输入法留用户）；③ 忙闲阈值「≥8 chunk/s」沿用——node-pty chunk 边界仍 ~8KB（burst p50=8214B、10.9MB/s、1583 chunk/s），busy 6-13/s、idle 无焦点 0/s。harness 在 `.workbuddy/terminal-port-spike/harness/`（#ab/#replay/#offline/#ime 四模式，渲染层=TerminalPane 逐字复刻）。

**阶段 1+2 已完成（2026-09-21，未提交）**：后端 `electron/backend/pty.ts`（PtyManager：spawn/write/resize/kill 树契约/shutdownAll）+ `clipboard-image.ts`（CF_HDROP 解析）+ `sessions.ts` 的 `sessionTitleFor`；IPC 五处同步（ipc-contract/preload/main/electron-api.d.ts/api.ts）；前端 `TerminalPane` + 四 lib 模块 + 统一 tab 模型（App.tsx 判别联合 kind、chatStatus 收进 tab.phase、ChatTabs/TabContextMenu 重写）+ 设置「默认交互方式」（config.defaultInteraction，KNOWN_CONFIG_KEYS 已加）+ 右键另一模式入口。350 测试过 / typecheck 过 / build 过。**真机验证过**：app 内点 + 开终端 tab → claude TUI 完整渲染（logo/欢迎屏）；WM_CLOSE 退出路径 → shutdownAll 杀树（cmd/claude/直接链全死；codegraph 守护进程深树残留=与 Tauri 同机制同限制）。**踩坑记录**：dev.mjs 的 esbuild external 曾与 build 漂移 → node-pty 被打进 bundle → conpty.node 加载失败——已抽 `tools/esbuild-main.config.mjs` 两处共用（勿再各自维护）；本机 nvm shim 会变 node 版本，构建/测试命令要显式用 v20.19.5；本机有 cua-driver 光标驱动抢合成点击，UI 自动化不可靠（用 app 内 hash hook 或进程树断言替代）。

**新发现的宿主差异（移植时注意，非门）**：node-pty 不做 PATH 解析（cmd 用 ComSpec 全路径）；含空格参数会被加引号（claude 链无空格不受影响）；`cmd /C 内部命令` 在 node-pty 1.1.0 ConPTY 下报「命令语法不正确」，只有 `cmd /D /S /C call <exe反斜杠路径>` 形态可靠；本机链上没出现 §6.7 的 cmd DSR（不应答也不黑屏）。**通道设计已验证**：渲染层预生成 token、先订阅 `spike:data:<token>` 再 invoke —— 比 Tauri 的 earlyExits 更干净。

**前置验证**（真机，阶段 0 前）：node-pty@1.1.0 预编译包在 Electron 41.7.1 ABI 145 直接加载；taskkill /T /F 收树干净（本次全部 kill 路径复核无孤儿）。

**用户的核心顾虑**：怕 Tauri 线里已修好/优化过的东西搬过去退化——简报 §6 那张「必须重新验证的 11 条」就是给他的答复，阶段 0/3 要正面回应，别绕。

**How to apply**：接任务先读简报+CONCLUSIONS.md+CLAUDE.md「app 内嵌终端」节；搬运期间逐字搬、不做"顺手改进"；Tauri 版当 A/B 基准（并排截图逐像素比）。⚠️ `npm i --no-save` 会 prune 掉此前同样 --no-save 装的包——spike 依赖（node-pty + 4 个 @xterm）必须一条命令装齐。相关：[[branch-sync-convention]]、[[embedded-terminal-plan]]、[[terminal-vs-cmd-measure]]、[[chat-spec-and-gaps]]

---

**2026-10-16 状态更新**：已全部落地并出货——2026-09-21 真机打包验证通过（win-unpacked 与 NSIS 安装包均可跑，终端 spawn / 渲染 / 杀树全过），源分支 `embedded-terminal` 已退休（本机 tag `embedded-terminal-final`）。阶段 3 清单里 **macOS 侧**（`dist:mac` 真机、平台差异项）至今未验，归入 docs/todo.md 的 T2 缺口。上文「阶段 1+2 已完成（未提交）」「下一步=阶段 3」等表述是当时快照，本文其余内容作历史踩坑档案读。
