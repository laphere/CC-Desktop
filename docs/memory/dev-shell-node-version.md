---
name: dev-shell-node-version
description: 这个仓库的 shell 里默认 node 是 v12（nvm），跑 npm test / npm run typecheck 会炸；要先把 E:\DevTool\node（v24）放到 PATH 最前
metadata:
  node_type: memory
  type: project
  originSessionId: 9f28b74f-a849-4fd2-8cf7-0445f3f9d9f7
  modified: 2026-09-25T13:55:40.438Z
---

2026-09-25 实测（claude-fast 仓库，Git Bash）：

- `node -v` → **v12.18.3**（来自 nvm：`C:\Users\laphe\AppData\Local\Author Software\nvm\.nodejs\node`）。项目 CLAUDE.md 里写的「本机 Node 22.22.2」已经过时。
- 用这个 node 跑：`npm run typecheck` → `tsc` 直接 `SyntaxError: Unexpected token '?'`；`npm test`（vitest 4）→ `ERR_UNSUPPORTED_ESM_URL_SCHEME`。**都是工具链版本问题，不是代码问题**，别据此判定改动有错。
- 可用的是 `E:\DevTool\node\node.exe`（**v24.19.0**）。跑法与结果（2026-09-25 全绿）：

```bash
export PATH="/e/DevTool/node:$PATH"
npm run typecheck        # web + electron 两个 project 都过
npm test                 # 394 passed / 1 skipped
```

- 直接调二进制也同理可行：`node node_modules/typescript/bin/tsc`、`node node_modules/vitest/vitest.mjs run`。
- `./node_modules/.bin/electron` 不受影响（原生二进制，不经 PATH 上的 node），所以我做 UI 探针/截图时一直能用。
