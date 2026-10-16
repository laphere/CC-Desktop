---
name: titlebar-wco
description: 2026-10-13 顶栏改自绘标题栏（titleBarStyle hidden + WCO 覆盖层）落地；覆盖层色的哨兵坑、高度两处同步、minWidth 抬 960
metadata:
  node_type: memory
  type: project
  modified: 2026-10-16T05:14:15.277Z
  originSessionId: 3c177271-2bc9-4d44-88fe-5bf16b22488e
---

2026-10-13 落地（3f64d74）：隐藏原生标题栏，应用名 / 状态胶囊 / 功能入口由页面 `.header` 自绘、整条可拖拽，系统的最小化 / 最大化 / 关闭经 `titleBarOverlay`（Window Controls Overlay）保留——它们是**真系统按钮**，双击最大化、Win11 贴靠布局照常可用。

改标题栏前必读的坑（权威注释在 main.ts 的 `TITLEBAR_COLORS` 与 styles.css `--titlebar-h` 附近）：

- **覆盖层 color 取 `rgba(1,0,0,0)`（非哨兵零 alpha）**：纯 `rgba(0,0,0,0)` 在旧版 Electron（≤41.10.6，本机 41.7.1）被当「未设置」回退成系统边框色；取不透明色则盖住网页内容——顶栏通栏分隔线在右上按钮区被截断，且「最大化 / 还原」两态下覆盖层实际范围还会变。
- **高度两处同步**：main.ts `TITLEBAR_HEIGHT = 44`（DIP）⇔ styles.css `--titlebar-h: 44px`，改一处要改两处；styles.css 刻意不取 `env(titlebar-area-height)`（它与覆盖层高度不一致时不兜底）。
- **symbolColor（系统按钮描边色）随主题**：经 `window_set_titlebar_theme` IPC 翻新（macOS no-op——交通灯由系统绘制，`.header` 靠 `env(titlebar-area-*)` 让位）；启动瞬间的初值在 createWindow 里先读一次 config（渲染层加载前就要定）。
- **minWidth 800→960**：顶栏内容与右侧覆盖层（约 138 DIP）同排后，800 会挤到重叠。（本条与 CLAUDE.md「顶栏与左栏布局」段已同步，2026-10-16。）

相关：[[animation-system-landed]]
