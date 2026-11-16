// 提示词历史（`~/.claude/history.jsonl`）——统计弹窗「提示词历史」tab 的数据源。
//
// 该文件由 Claude Code CLI 追加写入，每行一条 JSON：
// `{ display, pastedContents, project, sessionId, timestamp }`。
// - `display` 是提示词文本；`pastedContents` 是随消息粘贴的内容（可能很大），
//   本模块只记「有没有」、不把内容带出（渲染层用徽标提示）。
// - `timestamp` 为 **epoch 毫秒**（本机 2.1.319 实测，见下方口径注释）。
// - `project` / `sessionId` 可能缺失，按 null 处理。
//
// ⚠️ CLI 随时可能在写这个文件，读路径对坏行/半行必须宽容：**跳过而非报错**
// （一次写入被腰斩的行不该让整个历史页打不开）。只有文件缺失（ENOENT）才是
// 「无历史」，其余读失败抛可读错误。
import * as fs from "node:fs";
import * as path from "node:path";

export interface PromptHistoryEntry {
  display: string;
  project: string | null;
  sessionId: string | null;
  /** epoch 毫秒 */
  timestamp: number;
  /** 该条带粘贴内容（内容本身不返回） */
  hasPaste: boolean;
}

export interface PromptHistoryResult {
  entries: PromptHistoryEntry[];
  /** 过滤后总条数（不受 limit 截断），供「仅显示最近 N 条」提示 */
  total: number;
}

/** 单次返回上限（前端渲染保护；真实历史可达数千条） */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export async function listPromptHistory(
  cfgDir: string,
  opts: { limit?: number; search?: string } = {},
): Promise<PromptHistoryResult> {
  const p = path.join(cfgDir, "history.jsonl");
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], total: 0 };
    throw new Error(`读取提示词历史失败（可能正被 Claude Code 写入）：${String(e)}`);
  }

  const search = opts.search?.trim().toLowerCase() ?? "";
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT));

  const out: PromptHistoryEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // 半行/坏行跳过（CLI 正在写入）
    }
    if (o === null || typeof o !== "object" || Array.isArray(o)) continue;
    const rec = o as Record<string, unknown>;
    const ts = typeof rec["timestamp"] === "number" ? rec["timestamp"] : null;
    if (ts === null) continue;
    const display = typeof rec["display"] === "string" ? rec["display"] : "";
    if (search && !display.toLowerCase().includes(search)) continue;
    const paste = rec["pastedContents"];
    out.push({
      display,
      project: str(rec["project"]),
      sessionId: str(rec["sessionId"]),
      timestamp: ts,
      hasPaste: paste !== undefined && paste !== null && paste !== false,
    });
  }

  out.sort((a, b) => b.timestamp - a.timestamp);
  return { entries: out.slice(0, limit), total: out.length };
}
