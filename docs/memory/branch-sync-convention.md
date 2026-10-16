---
name: branch-sync-convention
description: claude-fast 分支线现状（2026-09-22 收口后）：只剩 dev（主线）与 main；Tauri 线只在本机 tag 里；main 只在 dev 稳定时提升，不自动同步
metadata:
  node_type: memory
  type: project
  originSessionId: 693d9a05-bf8f-4149-9087-e6db4648549a
  modified: 2026-09-21T17:00:13.279Z
---

**2026-09-22 第三次收口**（承接 09-21 的两轮重组）：Tauri 线彻底退出分支列表，仓库只剩 `dev` 与 `main`。

- `embedded-terminal` **退休**：它与 `main` 本就是同一提交（`0e17392`）、零独有提交 → 打本机 tag **`embedded-terminal-final`** 后删本地与远端。前提是内嵌终端已移植进 Electron 线并落地（`d5309b6` + `5158215` 两次提交）。
- `claude-fast-electron` **退休成 `dev`**：自其末态 `c4bfc31` 拉出 `dev` 并推远端 → 打本机 tag **`claude-fast-electron-final`** → 删本地与远端。
- `main` **强制指向主线**（`0e17392` → `2406b76`，`--force-with-lease`）。它此前装的是 Tauri 线快照，那份快照现在**只在本机 tag `embedded-terminal-final` 里**（`*-final` 系列一律未推远端，换机器就没了）。
- **提升策略（用户 2026-09-22 明确）**：`main` **不跟 `dev` 自动同步**，**dev 稳定了才推 main**。这是一次性人工动作，不是 ff-only 约定。

**Why**：用户按「一条线一个分支」持续收敛，且要 `main` 只在稳定点上前进（而不是每次提交都跟着动）。**How to apply**：动分支（改名/删除/推送/tag）前先跟用户确认，他一直在做分支维护；不要假定 `main` 是某条线的自动镜像，也不要假定远端还有 Tauri 线（远端已无）。相关：[[chat-spec-and-gaps]]、[[terminal-port-to-electron]]、[[v1-cleanup-2026-09]]
