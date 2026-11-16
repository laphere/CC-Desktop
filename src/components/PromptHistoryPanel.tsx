// 统计弹窗「提示词历史」面板：读 ~/.claude/history.jsonl（后端 cchistory），
// 倒序展示 + 关键字搜索（只匹配提示词文本）。粘贴内容不带出，只标「含粘贴」。
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { PromptHistoryEntry, PromptHistoryResult } from "../../electron/ipc-contract";
import { CheckIcon, CopyIcon, SearchIcon } from "./Icons";

/** 单次拉取条数（后端默认 200；历史可达数千条，避免一次性渲染爆炸） */
const PAGE_SIZE = 200;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 项目路径 → 末段目录名（完整路径走 title） */
function projectName(p: string | null): string {
  if (!p) return "—";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

function Row({ e }: { e: PromptHistoryEntry }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="hist-row">
      <div className="hist-display">{e.display || "（空）"}</div>
      <div className="hist-meta">
        <span className="hist-proj" title={e.project ?? undefined}>
          {projectName(e.project)}
        </span>
        <span className="hist-time">{fmtTime(e.timestamp)}</span>
        {e.sessionId && <span className="mono hist-sid">{e.sessionId.slice(0, 8)}</span>}
        {e.hasPaste && <span className="hist-badge">含粘贴</span>}
        <button
          type="button"
          className="icon-btn icon-btn-sm hist-copy"
          title={copied ? "已复制" : "复制提示词"}
          onClick={() => {
            navigator.clipboard.writeText(e.display).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1000);
            });
          }}
        >
          {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
        </button>
      </div>
    </div>
  );
}

export default function PromptHistoryPanel() {
  const [search, setSearch] = useState("");
  const [data, setData] = useState<PromptHistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const firstRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // 首次立即拉；之后输入停顿 300ms 再拉（搜索期间保留旧列表，只闪「搜索中…」）
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => {
        if (!firstRef.current) setSearching(true);
        api
          .ccHistoryList({ limit: PAGE_SIZE, search })
          .then((r) => {
            setData(r);
            setError(null);
          })
          .catch((e) => setError(String(e)))
          .finally(() => {
            setLoading(false);
            setSearching(false);
            firstRef.current = false;
          });
      },
      firstRef.current ? 0 : 300,
    );
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [search]);

  if (loading) return <div className="stats-empty stats-fill">读取提示词历史…</div>;
  if (error) return <div className="stats-empty stats-fill">读取失败：{error}</div>;

  const entries = data?.entries ?? [];
  return (
    <div className="hist-root">
      <div className="hist-search">
        <SearchIcon size={12} />
        <input
          className="hist-input"
          placeholder="搜索提示词文本…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {searching && <span className="cc-hint">搜索中…</span>}
      </div>
      {entries.length === 0 ? (
        <div className="stats-empty">{search ? "没有匹配的提示词" : "还没有提示词历史"}</div>
      ) : (
        <div className="hist-list">
          {entries.map((e, i) => (
            <Row key={`${e.timestamp}-${i}`} e={e} />
          ))}
        </div>
      )}
      {data && data.total > entries.length && (
        <div className="cc-hint hist-more">
          共 {data.total} 条，仅显示最近 {entries.length} 条（搜索可缩小范围）
        </div>
      )}
    </div>
  );
}
