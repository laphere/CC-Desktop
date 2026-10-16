# 过渡动画体系落地（2026-09-26，待真机验证）

P0–P2 三批 + 同日 code review 修正全部完成，typecheck / 400 测试 / build 全绿。设计判据与陷阱**全在 CLAUDE.md**「过渡动画体系 / 让位与进场 / 折叠与大块翻转」三条，动 UI 前先读。新 lib：`src/lib/flip.ts`（useFlip）、`src/lib/view-transition.ts`（viewTransition）。

## 真机验证要点（未做，用户参与）
- **details 折叠的收起方向**：`::details-content` + `content-visibility allow-discrete` 是最依赖 Chromium 实测行为的一点；若收起瞬切、展开正常 → 收起路径换 grid 0fr↔1fr 包裹（P2 时留的 fallback）。
- **四条确认流程**（移除项目/删会话/关在跑终端/清除失效）点确定必须关且播出场（force 修复的回归）；busy 中 Esc 仍被拦。
- **Esc 守卫跨 tab**：A tab 留 `/` 面板切 B tab，B 页 Esc 能正常打断。
- **置顶区整块显隐**时项目列表平滑推移（`.left-scroll` 第二层 FLIP）。

## 暂缓项（等用户点头再做）
card-slot 卡片显隐、两条搜索条（left-search / viewer-search）、pendingImages 缩略图、条目级出场（关 tab/删行的延迟卸载）——评审第四节列的同类缺口，各自是取舍不是 bug。
