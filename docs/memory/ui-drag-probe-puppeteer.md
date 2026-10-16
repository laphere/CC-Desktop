# 渲染层交互的自动化探针（puppeteer-core + vite harness）

2026-09-25 为查「tab 拖拽不生效」建的一次性方法，**可复用于任何 DOM/拖拽/交互类问题**
（本仓 `vitest.config.ts` 明说「renderer 侧无组件级自动化」，这条路就是补那一块的）。

## 配方

1. **别去动正在跑的 app**：主进程 `app.requestSingleInstanceLock()` 的锁按 userData 分键，
   而 `main.ts` 把 userData 硬编码到 `%APPDATA%\claude-fast\userdata`——`APPDATA` 环境变量
   与 `--user-data-dir` **都改不动它**（2026-09-25 实测：重定向 APPDATA 起第二个实例，
   启动即被单实例锁顶掉退出）。也别改 `electron/` 下的源码做临时开关——`dev.mjs` 在
   watch 那里，会连带**重启用户正在用的 Electron**。
2. **干净的做法**：在仓库根临时放 `__dragtest.html` + `__dragtest.tsx`（用完即删），
   harness 直接 `import ChatTabs from "./src/components/ChatTabs"` + `import "./src/styles.css"`，
   用真组件 + 真样式渲染一份最小状态。**用户自己的 vite dev server（1420）未必在跑**，
   起一个自己的：`npx vite --port 1421 --strictPort --host 127.0.0.1`。
3. **驱动**：临时目录里 `npm i puppeteer-core`（不碰仓库的 package.json），
   `puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" })`。
   - 合成事件（隔离 React 接线）：`page.evaluate` 里 `dispatchEvent(new DragEvent(...))`，
     **务必在每个事件之间 await**，否则 React 来不及重渲染，`dragId` 之类的 state 读到的是旧值。
   - **真鼠标拖拽**（隔离「浏览器到底有没有起拖拽」）：`page.setDragInterception(true)`
     + `page.mouse.drag(start, target)` → `dragEnter`/`dragOver`/`drop`，**每次 drop 后补
     `page.mouse.up()`**（否则下一次 `mouse.drag` 报 `'left' is already pressed`）。
4. **要读的常量**：`el.getAttribute('draggable')`、`getComputedStyle(el).webkitUserDrag`
   （应为 `element`）、以及把「事件流 + 组件回调调用」打到 `window.__log` / `window.__reorders`
   再由 probe 读回——**没有这层插桩就会误判**（本次就是靠它才看出「其实换位了，
   只是我拿初始顺序在比对」）。

## 本次结论（写进代码注释与 CLAUDE.md 了）

拖拽落点挂在各个 tab 上是死区陷阱：那条栏只有 27px 高、上方还有 6px 内边距，
最后一个 tab 右侧是大片空白——落在 tab 以外的位置全都不触发 drop。落点必须挂在**栏容器**上。

## 2026-09-26 再用一次（Esc 撤回失效归因），新坑两条

查「发送后 Esc 不回填输入框」：harness 渲染真 ChatView + 桩 `window.claudeFast`，puppeteer
`page.type` + `keyboard.press` 打真键盘。两条新经验：

1. **桩必须放 harness HTML 的 `<head>` 内联 `<script>`**——`api.ts` 在**模块加载期**就执行
   `const bridge = window.claudeFast`，写在 tsx 模块体里会因 import 提升而晚于它
   （首跑即报 `undefined (reading 'invoke')`）。
2. **桩不推事件 = 探不到事件侧的 bug**：根因是 CLI 对每条带 uuid 的消息都发
   `command_state`（app 每条都盖 uuid），而 harness 起初一帧不推、链路全绿，差点误判
   「代码没问题」。**桩要按真 CLI 的帧序列推**（chat_send 后 ~300ms 补一帧
   `command_state:queued`），先复现再修。结论与修法在 CLAUDE.md「中断/撤回」条。
