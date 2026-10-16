# Memory Index

- [Electron CDP 探针](electron-cdp-probe.md) — 用户实例在跑时的零依赖 UI 机理验证法：默认应用模式 harness.html 绕单实例锁 + Node 24 原生 WebSocket CDP
- [Animation system landed](animation-system-landed.md) — 2026-09-26 P0–P2 过渡动画 + 评审修正全落地（FLIP/弹层出场/折叠/ViewTransition，机制在 CLAUDE.md）；真机验证要点与暂缓项在文内
- [自绘标题栏 WCO](titlebar-wco.md) — 2026-10-13 顶栏自绘 + WCO 系统按钮落地；rgba(1,0,0,0) 哨兵坑 / 高度两处同步 / minWidth 抬 960

- [Embedded terminal plan](embedded-terminal-plan.md) — 内嵌终端（PTY+xterm.js）2026-09-20 已并入 v1.0.0/main（版本 1.1.0）；含实测踩坑（kill 顺序、嵌套 env 剥离、贴图三路、观感对齐）与 IME 候选窗锚点修复（2026-09-20 用户真机实测通过）
- [Claude launchers setup](claude-launchers-setup.md) — Claude quick-launch app, rebuilt 2026-08-06 as Tauri 2 + React/Rust (was WinForms); current details in in-repo CLAUDE.md; D:\MyWorkspaces workspace layout
- [Resume window not needed](resume-window-not-needed.md) — 「继续对话」only needs to open claude + resume; window need NOT stay open after claude exits (don't re-flag exec claude as a bug)
- [Branch sync convention](branch-sync-convention.md) — **2026-09-22 收口：只剩 `dev`（主线）与 `main`**；Tauri 线已退休、只在本机 tag `embedded-terminal-final`；`main` 只在 dev 稳定时提升（不自动同步）
- [Session search deferred](session-search-deferred.md) — **项目内跨会话搜索**仍暂缓（会话页内单会话搜索已另有实现）；再提时直接看 docs/session-search-plan.md，勿从零设计——文内参考的 lib.rs 已随 v2 删除
- [v1 cleanup 2026-09](v1-cleanup-2026-09.md) — 2026-09-19 清理全包完成并推送；2026-09-20 双线并行（v1.0.0=1.1.0 含终端，v2.0.0 无终端）；2026-09-21 v2.0.0 删除
- [v2.0.0 goal: GUI chat](v2-goal-gui-chat.md) — 页面内 GUI 对话的目标已由 electron 主线用 Agent SDK 实现；v2.0.0 已删除（「该分支不要终端」的取舍不适用于主线）
- [Chat spec and gaps](chat-spec-and-gaps.md) — 对话层规格 + B1–B16 缺口清单在 docs/chat-behavior-spec.md（v2 删除时抢救的唯一副本）；B1–B7 已修，剩 B8–B16
- [Terminal port to Electron](terminal-port-to-electron.md) — 内嵌终端并进 Electron 线（一个 app 两种模式）；**已落地出货**（2026-09-21 真机打包验证全过；macOS 侧仍未验，归 docs/todo.md T2），踩坑与复跑法在文内
- [Terminal vs cmd measure](terminal-vs-cmd-measure.md) — 并排截图逐像素比 terminal 与 cmd 的量法（行高看高亮条、字面看墨迹 bbox），结论/修法见 c649797
- [Agent SDK sidecar evaluated](agent-sdk-sidecar-evaluated.md) — 2026-09-20 评估「Node sidecar + claude-agent-sdk」方案：当时不采用（chat.rs 已是同一协议的手写客户端）；2026-09-21 起 Rust 侧结论已无对处（v2 删除），SDK 实际落在 electron 主线
- [ExitPlanMode needs permission-prompt-tool](exitplanmode-needs-permission-prompt-tool.md) — 订正错结论：--print 下加 `--permission-prompt-tool stdio` 即可让 ExitPlanMode/AskUserQuestion 进工具表；SDK 会自动补
- [Chat readability tuning](chat-readability-tuning.md) — 会话页可读性整改定稿参数；固定宽度、左侧竖线轮次锚点这两个我自加的方案均被否，别再提
- [Agent SDK capabilities doc](agent-sdk-capabilities-doc.md) — 动对话层前先读 docs/agent-sdk-capabilities.md；标 `型` 的别直接落地，先跑探针
- [Rewind recovery via file-history](rewind-recovery-file-history.md) — /rewind 卷掉的改动没真丢，`~/.claude/file-history/<session-id>/@vN` 里有逐字节快照，恢复步骤在此，别急着重做
- [AskUserQuestion Stream closed](askquestion-stream-closed.md) — 2026-09-22 首现未定案：CLI 不超时、中断不是这条路（已实测排除）；待验假设=提问卡挂起时 tab 被关（close 关流但没杀净子进程），探针在 %TEMP%\ask-probe\
- [Dev shell node version](dev-shell-node-version.md) — 这个 shell 里默认 node 是 v12（nvm），`npm test`/`npm run typecheck` 会炸；先 `export PATH="/e/DevTool/node:$PATH"`（v24）再跑
- [渲染层交互探针](ui-drag-probe-puppeteer.md) — 用临时 harness 页 + puppeteer-core 驱真 Chromium 验 DOM/拖拽（配 vitest 缺的那块）；含「别动用户正在跑的实例」与 setDragInterception 的写法
- [Todo: SDK 用足 + 全面审查](todo-sdk-and-review.md) — 2026-09-22 起的待办清单（SDK 能力落地 / 代码审查含 macOS / 健康检查一键装 claude），正文在 docs/todo.md；T2 有两处实锤 Mac 缺口
