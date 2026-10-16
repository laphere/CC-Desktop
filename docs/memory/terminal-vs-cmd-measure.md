---
name: terminal-vs-cmd-measure
description: 拿并排截图逐像素比对「内嵌终端 vs cmd」的方法（量行高/字面的可靠锚点 + 无依赖量图手法）
metadata: 
  node_type: memory
  type: project
  originSessionId: 66c83271-2f67-46fc-950a-3acc2f13b5ac
  modified: 2026-09-20T06:38:50.244Z
---

老板报"app 终端字/行距和 cmd 不一样"时，给的是一张并排截图（app 窗 + cmd 窗同屏，同一 DPR）。可直接在 Node 里解 PNG 量墨迹，不用装任何库（zlib inflate + 手动反 filter，约 60 行，临时脚本用完就删；Edge 无头 `--force-device-scale-factor=1.5 --dump-dom` 可跑字体/度量实验，canvas 的 `fontBoundingBoxAscent/Descent` 就是 xterm 用的字行盒）。

可靠锚点：
- **单元格高度** = 用户消息那条灰色高亮条的上下沿（lum≈55，占满整格）；比量字形顶靠谱（字形顶受上升部与阈值影响 ±1px）。
- **字面大小** = 同一句里同一个字的墨迹 bbox，阈值 40（含抗锯齿）与 140（核心墨迹）各量一次。
- **列宽** = 同一串 ASCII（如 `[deepseek-v4.1-flash`）的字形起点差。两边背景都是 #0c0c0c（lum 12）。

结论与修法已落在代码注释里（2026-09-20，中文 TermCJK size-adjust、行高 alignRowHeight；原 c649797 已随分支 squash 并入单提交 8d51680），别再从头推；要复现按上面锚点量即可。相关：[[embedded-terminal-plan]]
