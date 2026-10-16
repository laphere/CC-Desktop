---
name: rewind-recovery-file-history
description: 用户用 /rewind 回滚后，被卷掉的改动可从 ~/.claude/file-history/<session-id>/ 的 @vN 快照逐字节恢复
metadata: 
  node_type: memory
  type: reference
  originSessionId: 14faea11-e06a-4e9b-899d-273f5f6b43f5
  modified: 2026-09-22T19:45:13.234Z
---

`/rewind` 回滚 = 把工作区文件还原到检查点，**但回滚前那版文件内容仍留在**
`~/.claude/file-history/<session-id>/<hash>@vN` 里（每次改动一份快照，按时间排序）。
session-id 取 `~/.claude/projects/<mangled-项目>/` 下 mtime 最新的那个 jsonl 同名。

**与 SDK 检查点同源**（2026-09-23 实测）：SDK 的 `enableFileCheckpointing` + `rewindFiles()`
快照就存在**同一个** `~/.claude/file-history/<session-id>/` 里（jsonl 用 `file-history-snapshot` /
`file-history-delta` 条目记账），见 docs/agent-sdk-capabilities.md §6.10。

恢复步骤（2026-09-22 实测走通）：
1. 按文件大小把 `<hash>` 对上仓库文件（`stat -c%s` 遍历 `git ls-files` 比对，即可认出
   哪个 hash 是哪个文件）；
2. `diff -u <hash>@vN <该文件>` 确认 vN 相对当前只多出被卷掉的那部分；
3. `cp` 回去，再跑 `npm run typecheck` + `npm test` 复验。

**Why:** 用户回滚工作时会以为改动全丢了（2026-09-22 就这样问过「修改还能恢复吗」），
直接重做等于把已写完并自检过的一版再写一遍，还容易写成不一样的。

**How to apply:** 用户说「rewind 把改动弄没了 / 还能恢复吗」时，先去 file-history 找快照，
不要接受重做。恢复后照旧过 typecheck/测试，并说明改动**未提交**（回滚不影响 git 暂存区与历史）。
注意快照按 session 分目录，找错 session 会翻到旧版本的同一文件。相关：[[chat-spec-and-gaps]]
