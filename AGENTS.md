# AGENTS.md — 编码代理接手指南（桥接层）

> 本文件是给任何编码代理（Claude Code 之外的 harness 同样适用）的项目入口。
> 项目的**真源文档**是仓库根目录的 `CLAUDE.md`——几万字的完整说明书（架构、每个功能模块的实测坑、铁律、开发命令），本文件不复制它，只做「必读守则 + 按需指路」，避免一次性灌满上下文。
> 与用户沟通用简体中文。

## 项目是什么（30 秒版）

- **CC Desktop（claude-fast）**：Electron（Node 主进程）+ React + TypeScript + Vite 的桌面应用，一键在项目目录启动 / 继续 Claude Code 会话，含 app 内对话（官方 Agent SDK 托管）与内嵌终端（node-pty + xterm.js）。Windows + macOS。
- 分支只有 `dev`（主线，日常开发）与 `main`（dev 稳定后人工提升，不自动同步）。
- 历史上的 PowerShell/WinForms 版、Tauri/Rust 版（v1–v3 旧版号）**均已作废**，不要按旧版本号理解代码；当前全部代码为 v1.0.0。

## 必读守则（动手前）

### 铁律（摘要，全文见 CLAUDE.md「铁律」节）

1. **绝不删除数据根的 `config.json` / `.bak`**——用户清单/排序/置顶都在里面。写配置永远走临时文件 → 备份 → 原子替换。
2. **配置一律经 `updateConfig` / `mutateConfig` 读改写，不许从参数重建**；持锁（`withConfigLock`）期间严禁再调另一个取锁函数——链式锁不可重入。
3. **会话删除必先备份**进回收站（`trash/sessions/`），恢复时目标已存在必须拒绝。
4. **渲染进程零 Node 权限**：新增后端能力要在 `electron/main.ts`（IPC handler）+ `electron/preload.ts`（白名单）+ `src/lib/electron-api.d.ts`（类型）三处同步。
5. `vite.config.ts` 的 `base: './'` 是 file:// 加载前提，勿删。
6. **打包必须走 `npm run dist:*`**（= build + electron-builder），直接 `electron .` 找不到模块。
7. **两条打包铁律**：`node-pty` 与 `@anthropic-ai/claude-agent-sdk` 必须留在 esbuild `external`（共用 `tools/esbuild-main.config.mjs`）；SDK 平台包（`claude-agent-sdk-*`，各 237MB）必须从 `build.files` 排除、SDK 主包必须 `asarUnpack`。

### 环境坑（本机 Windows）

- 这个 shell 默认的 `node` 是 v12（nvm 指过去的）：直接 `npm test` / `npm run typecheck` 会炸（`ERR_UNSUPPORTED_ESM_URL_SCHEME` 等）——是工具链版本问题不是代码问题。先 `export PATH="/e/DevTool/node:$PATH"`（v24）再跑。
- 常用命令：`npm run dev`（开发）、`npm test`（435+ 后端单测）、`npm run typecheck`、`npm run build`、`npm run dist:win` / `dist:mac`。

### Git 提交规范

- 标题行只写「做了什么」：`前缀:改动点`，一行说完，尽量 ≤30 个汉字。**禁止**标题里用「——」引出解释、括号补原因、分号罗列细节——细节留给 diff 或正文段。
- 确需交代背景时另起正文段（与标题空一行），几句话说完。
- 沿用项目已有前缀与语言：`update:` / `feat:` + 中文，与团队历史提交保持一致。

### 代码注释规范

- 注释只解释当前代码（做什么、为什么这样设计），必须**自包含**——读者只看当前文件就能懂。
- 不写改动视角（「改前如何/现在改成如何」）、不解释代码里不存在的方案、不固化可推导或易过时的数字（写意图不写推导值）。改动说明归 commit message。

## 按需指路（改什么，先读什么）

| 要动的领域 | 先读 |
|---|---|
| **任何改动动手前** | `CLAUDE.md` 全文过一遍（第一次接手时）；之后按本表按需重读相关节 |
| 对话层（`electron/backend/chat.ts` / Agent SDK） | CLAUDE.md「app 内直接对话」节 + `docs/agent-sdk-capabilities.md`（68 开关/39 事件，标 `型` 的先跑探针）+ `docs/agent-sdk-interactive-tools.md` |
| 对话行为规格与待补缺口 B8–B16 | `docs/chat-behavior-spec.md` |
| 内嵌终端（PTY / xterm.js） | CLAUDE.md「app 内嵌终端」节（含 spawn 链、kill 契约、打包铁律——坑最密的区域） |
| UI / 动画 / 样式 | CLAUDE.md「顶栏与左栏布局」「过渡动画体系」「让位与进场」「折叠与大块翻转」「UI 约定」节（含逐像素实测的按钮居中定版值） |
| 会话页 / 历史 jsonl 解析 | CLAUDE.md「会话页 = 对话 + 内容查看二合一」节 |
| 待办全景 | `docs/todo.md`（SDK 用足 + 代码审查 + macOS 缺口） |
| 项目内跨会话搜索 | `docs/session-search-plan.md`（已暂缓，再提时**勿从零设计**） |
| 用量统计迭代 | `docs/usage-stats-iteration-plan.md` |
| 数据根 / 便携模式判定 | CLAUDE.md「数据根目录（双模式）」节（`KNOWN_CONFIG_KEYS` 与历史版本逐字同表的约束） |

## 历史决策与被否方案（别重蹈覆辙）

`docs/memory/` 是 **2026-10-16** 从 Claude Code auto-memory 拍的快照，索引在 `docs/memory/MEMORY.md`。它记录的是跨会话沉淀的结论，四类最有价值：

- **订正过的错误结论**：如 `exitplanmode-needs-permission-prompt-tool.md`（权限口径曾被推错又订正）、`agent-sdk-sidecar-evaluated.md`。
- **被用户否掉的方案，别再提**：`chat-readability-tuning.md`（固定宽度、左侧竖线锚点两个方案均被否）。
- **暂缓事项再提时直接看既有计划**：`session-search-deferred.md`、`todo-sdk-and-review.md`。
- **实测方法论（探针怎么跑）**：`electron-cdp-probe.md`（零依赖 CDP 驱真实例）、`ui-drag-probe-puppeteer.md`、`terminal-vs-cmd-measure.md`（逐像素量法）。

⚠️ 快照日期之后的决策不在此列——以 git log 与 CLAUDE.md 当前文本为准。若本项目此后不再用 Claude Code 开发，新的决策应继续写进 CLAUDE.md 对应小节，保持「真源唯一」。

## 历史版本线考古（取旧代码的唯一入口）

旧分支均已删除，只剩四个本机/远端 tag 作为存档：`v1.0.0-final`、`v2.0.0-final`（Tauri 线）、`embedded-terminal-final`、`claude-fast-electron-final`。取旧代码用 `git show <tag>:<path>`。哪些线作废、作废后语义归谁，见 CLAUDE.md 开头的「版本线」引注。
