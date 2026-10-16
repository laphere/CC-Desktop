---
name: resume-window-not-needed
description: "For claude-fast \"继续对话\"/resume, only need to open claude and resume the session — terminal window need NOT stay open after claude exits"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fe2b16e6-cd40-47da-a60a-8da9a8610d08
  modified: 2026-08-12T18:59:09.899Z
---

For the claude-fast **「继续对话」(resume_session)** feature — and launch — the only requirement is: open claude and resume to that session (resume), or open a fresh claude in the project dir (launch). The user explicitly does **not** need the terminal window to stay open after claude exits, nor 「继续输入」(continue typing in the terminal after claude exits). Stated 2026-08-13.

**Why:** During a v2.0.0→v3.0.0 macOS review I flagged `exec claude --resume` as a bug because the `resume_session` doc comment claimed "窗口保持：claude 退出后窗口不关，能看到错误或继续输入" yet `exec` can't deliver that. The user corrected me: window-retention was never a requirement — the comment over-promised. `exec claude --resume <id>` already does exactly what they want. I then corrected the misleading comments (lib.rs `resume_session` + `launch_script_impl` mac) rather than changing `exec`.

**How to apply:** `exec claude` / `exec claude --resume` (macOS) and `call claude` / `cmd /k ... claude --resume` (Windows) are the intended mechanisms. Do **not** propose keeping the window open after claude exits, and do **not** re-flag the absence of post-exit window retention as a bug. Related: [[claude-launchers-setup]].
