---
name: claude-launchers-setup
description: "User's Claude Code quick-launch app — rebuilt 2026-08-06 as Tauri 2 + React/Rust (was a WinForms/PowerShell GUI). Everything current lives in in-repo CLAUDE.md."
metadata:
  node_type: memory
  type: project
  originSessionId: 7996507b-0c7b-47e6-80a7-55f83fa3bc88
  modified: 2026-08-14T09:09:05.297Z
---

User (肖鹏飞, Chinese-speaking) runs Claude Code in many projects under `D:\MyWorkspaces` and maintains a quick-launch launcher app in **`D:\MyWorkspaces\myProject\claude-fast`**.

**2026-08-06 the launcher was rewritten** from a PowerShell/WinForms GUI (old `launcher-gui.ps1`, `start-gui.vbs`) to a **Tauri 2 + React + TypeScript + Vite + Rust** desktop app. The old WinForms notes below are **historical only** — do not apply them to the current codebase.

**Current architecture** (authoritative: in-repo `CLAUDE.md`, read it before editing):
- Frontend `src/` (React; state in `App.tsx`, Tauri invoke wrapped in `src/lib/api.ts`); backend `src-tauri/src/lib.rs` (all commands, unit tests).
- **Dual data-root**: portable mode (exe dir containing `config.json` + `scripts/`) vs install mode `%APPDATA%\claude-fast`. `resolve_root_dir()` in lib.rs picks automatically.
- Per-project `claude-<name>.bat` must use `call claude` (not bare `claude` — claude is a `.cmd` shim), UTF-8 + CRLF, `chcp 65001`, `pause` on error. Naming: path relative to `D:\MyWorkspaces`, `\` → `-`.
- `WORKSPACE_ROOT` constant in `lib.rs` = `D:\MyWorkspaces` (batch-add scan scope).
- **Build ONLY with `npm run tauri build`** — bare `cargo build --release` lacks `--features tauri/custom-protocol` and produces a dev build that connects to `http://localhost:1420` and white-screens.
- **NEVER delete `config.json` / `.bak`** in the data root — user favorites live there; `save_config` uses temp-write → `.bak` backup → atomic replace.

**Why:** User previously had to enter each workspace, open cmd, and type `claude` manually; keeps evolving the launcher as a first-class project in the current folder. The rewrite to Tauri (2026-08-06) is the current iteration — the user is actively iterating on it.

**How to apply:** When asked to launch Claude in a project or add a project, reference `D:\MyWorkspaces\myProject\claude-fast`. Claude CLI is at `E:\DevTool\node18-global\claude` (works in cmd via `claude`). Prefer in-repo `CLAUDE.md` over this memory for current behavior.

**2026-08-07 iteration (DONE, user-verified "实测没问题"): single-instance.**
- Added `tauri-plugin-single-instance` (Rust-only, no frontend/JS change; register in `run()` with a callback that shows + unminimizes + focuses the existing `"main"` window instead of starting a new process). Lock keyed on the app identifier `com.claudefast.launcher`, so install-mode and portable exes also share it.
- Non-obvious Windows trick (baked into the code comment, don't "clean it up"): after `set_focus`, toggle `set_always_on_top(true)` → `(false)`. The plugin callback runs in the *first* process, which may not hold foreground rights, so a bare `set_focus` only flashes the taskbar. Slight z-order flicker is the accepted cost for reliable foregrounding.
- **User's iterate loop (durable preference): implement → `npm run tauri build` (installer at `src-tauri/target/release/bundle/nsis/claude-fast_1.0.0_x64-setup.exe`) → user tests the real build in practice → only THEN commit & push to `origin/main`.** The user explicitly confirmed the build works before asking to commit. Don't push before the user has verified the built app.
- Build & commit history confirm the repo lives on `main`, remote `github.com:laphere/claude-fast.git`, git user 肖鹏飞.

**2026-08-14: version line RESET.** The user re-planned versioning: the repo was re-baselined as **v1.0.0** (single init commit "init: Claude助手 v1.0.0", branch `v1.0.0`, all features shipped so far — sessions, trash, macOS support, single-instance — are now just "v1.0.0"). Old commit hashes and the old version narrative (v2.x/v3.x) are void; do not cite them. productName is now 「Claude助手」. CLAUDE.md was rewritten 2026-08-14 to match (61 tests, 22 commands, no version-phase markers).

---

*(Historical, pre-2026-08-06 WinForms version — superseded, kept only for context)*

- Desktop shortcut `Claude 快速启动.lnk` → `wscript.exe` + `start-gui.vbs`; GUI was `launcher-gui.ps1` (WinForms, scanned `claude-*.bat`).
- OwnerDraw quirks (PS 5.1): `DrawItem` `$e.Index` null → use `$e.Item`; `RedrawItems(int,int,bool)` signature; stale `$e.State.Selected` → check `$item.Selected`; only intercept red health-check rows, else `$e.DrawDefault=$true`.
- `New-Bat` could crash on non-workspace paths (`Substring` out of range) — guard with `StartsWith(workspaceRoot, OrdinalIgnoreCase)`.
- PS 5.1 reads UTF-8-no-BOM as ANSI/GBK → CJK in throwaway scripts can swallow newlines; keep diagnostic .ps1 ASCII-only or save with BOM.
- Smoke-testing New-Launcher via forced-OK stubs wrote fake `claude-*.bat` into the folder — always delete after, verify count back to the real set.
