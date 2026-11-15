import type { ReactNode } from "react";
import type { SessionInfo } from "../types";
import { PinIcon } from "./Icons";

interface Props {
  session: SessionInfo;
  /** 已置顶（位于置顶区）→ 图钉按钮语义为「取消置顶」；项目内会话恒为 false */
  pinned: boolean;
  /** 打开中的对话 tab 正显示该会话 */
  active: boolean;
  /** 置顶区里显示的所属项目名（项目内部会话列表不传） */
  projectName?: string;
  /** 搜索结果行的关键词高亮（标题用；空串/不传 = 不高亮，列表常态）。
   *  ⚠️ 归一口径必须与后端 normalizeKeyword（electron/backend/session-extra.ts）
   *  逐字同步：trim + 连续空白折叠单空格 + lowercase，否则「命中不亮」/错位 */
  highlight?: string;
  onOpen: () => void;
  onTogglePin: () => void;
  /** 会话行右键菜单（终端继续/重命名/置顶/删除收进菜单，行上不放按钮挤占标题宽度） */
  onContextMenu: (x: number, y: number) => void;
}

/** 关键词高亮：大小写不敏感的字面子串切分。不用正则——关键词含正则元字符
 *  （括号、点号等）也能安全高亮，与后端 indexOf 的匹配语义逐字一致 */
export function highlightKeyword(text: string, kw: string | undefined): ReactNode {
  const k = (kw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (k === "") return text;
  const lower = text.toLowerCase();
  if (!lower.includes(k)) return text;
  const parts: ReactNode[] = [];
  let i = 0;
  let key = 0;
  for (let idx = lower.indexOf(k); idx !== -1; idx = lower.indexOf(k, i)) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={key++}>{text.slice(idx, idx + k.length)}</mark>);
    i = idx + k.length;
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

/** 相对时间：刚刚 / x 分钟前 / x 小时前 / 昨天 / MM-DD HH:mm */
export function formatTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return "昨天";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 单条会话行：置顶聚合区 / 搜索结果区专用（项目内会话列表为内联行） */
export default function SessionRow({
  session,
  pinned,
  active,
  projectName,
  highlight,
  onOpen,
  onTogglePin,
  onContextMenu,
}: Props) {
  return (
    <div
      className={`session-row ${active ? "active" : ""}`}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e.clientX, e.clientY);
      }}
      title={[session.title, session.summary, "点击在 app 内继续对话 · 右键更多操作"]
        .filter(Boolean)
        .join("\n")}
    >
      <button
        className="session-pin"
        title={pinned ? "取消置顶" : "置顶（在顶部聚合区常驻显示）"}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
      >
        <PinIcon />
      </button>
      <div className="session-body">
        <div className="session-title">
          {projectName && <span className="session-project">{projectName}</span>}
          {highlightKeyword(session.title, highlight)}
        </div>
        <div className="session-meta">
          {formatTime(session.lastModified)}
          {session.summary && ` · ${session.summary}`}
        </div>
      </div>
    </div>
  );
}
