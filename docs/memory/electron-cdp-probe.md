---
name: electron-cdp-probe
description: 用户 app 实例在跑时的零依赖 UI 机理探针：Electron 默认应用模式加载 harness.html（绕单实例锁）+ Node 24 原生 WebSocket 走 CDP
metadata:
  node_type: memory
  type: project
  originSessionId: 548d6ec4-3117-4707-92f5-89145efd8411
  modified: 2026-10-08T11:49:12.564Z
---

验证本项目 UI 机理（收放抽屉、几何不变量）而用户正开着打包版 CC Desktop 时的探针手法（2026-10-08，harness 在 `%TEMP%\sidebar-probe\`）：

- **不能**直接起 dev 实例：`main.ts` 硬编码 userData=%APPDATA%\claude-fast\userdata，`requestSingleInstanceLock` 按它判重——第二实例秒退（code 0），且不该动用户实例。
- **解法**：`spawn(require("electron"), ["--remote-debugging-port=<port>", harness.html])` ——传 HTML 文件路径走 Electron **默认应用模式**，不加载项目 main.ts → 无单实例锁、不碰用户数据；默认应用 userData 在 %APPDATA%\Electron，天然隔离。
- **驱动**：Node 24 全局 `fetch`（`http://127.0.0.1:<port>/json/list` 找页面）+ 全局 `WebSocket`（连 webSocketDebuggerUrl）手写 JSON-RPC 即可，不需要 playwright-core（项目里也没有）。
- harness.html 里 `<style>` 内联真 `styles.css` + 复刻 DOM 层级 + 手写与 App.tsx 同款逻辑序列；断言几何/类名/transform/visibility/命中测试（elementFromPoint 验 z 序、computed style 验不透明底）。
- Read 工具读 PNG 在本环境走上传通道不给看图，视觉要素改用程序化断言。
- 起本地 vite 必须 `--host 127.0.0.1`（localhost 解析 ::1，dev.mjs 注释点名过的坑）；杀进程只按 PID（netstat 查端口），别 taskkill /IM node.exe（用户有别的 node 在跑）。

相关：[[ui-drag-probe-puppeteer]]（puppeteer 版渲染探针）
