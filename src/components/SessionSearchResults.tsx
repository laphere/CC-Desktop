import type { PinnedSessionInfo, Project, SessionInfo } from "../types";
import { projectNameOf } from "../lib/session-file";
import SessionRow from "./SessionRow";

/** 搜索状态机：驱动状态行文案。searching = 搜索已发起（防抖窗口 + IPC 在途）；
 *  error = 搜索失败（此时列表已清空，不显示驻留的旧词结果） */
export type SessionSearchPhase = "idle" | "searching" | "done" | "error";

interface Props {
  results: PinnedSessionInfo[];
  /** 全局命中超过 50 条只回了最新前 50（后端截断发生在全局排序之后） */
  truncated: boolean;
  phase: SessionSearchPhase;
  /** 当前搜索词（命中行标题的关键词高亮） */
  keyword: string;
  /** 打开中的对话 tab 正显示的会话文件 */
  activeSessionFile: string | null;
  /** 项目清单：项目名徽标 */
  projects: Project[];
  /** 已置顶会话的 jsonl 路径集合：命中行图钉的置顶态（漏了会把已置顶行显示成
   *  「置顶」，点击等于意外取消置顶） */
  pinnedFiles: Set<string>;
  onOpenSession: (projectPath: string, session: SessionInfo) => void;
  onTogglePin: (projectPath: string, file: string) => void;
  /** 删除会话（移入回收站）：行尾归档按钮确认后触发 */
  onDeleteSession: (projectPath: string, session: SessionInfo) => void;
  onSessionContextMenu: (x: number, y: number, projectPath: string, session: SessionInfo) => void;
}

/**
 * 顶栏搜索的会话结果区（跨项目、标题/摘要口径）：搜索期间顶在置顶区原位（置顶区
 * 让位避免重复显示，已置顶会话照样参与召回，图钉呈置顶态）。容器复用 .pinned-block
 * 形态——布局与置顶区完全一致，也顺势进 App 侧 FLIP 的基线选择器。
 */
export default function SessionSearchResults({
  results,
  truncated,
  phase,
  keyword,
  activeSessionFile,
  projects,
  pinnedFiles,
  onOpenSession,
  onTogglePin,
  onDeleteSession,
  onSessionContextMenu,
}: Props) {
  // 空结果也要渲染（done + 0 条 = 「没有匹配的会话」）：否则用户分不清「还没搜完」
  // 和「搜完没结果」；error 态列表已清空，只显示失败提示
  const statusText =
    phase === "searching"
      ? "正在搜索会话…"
      : phase === "error"
        ? "搜索失败，请重试"
        : results.length === 0
          ? "没有匹配的会话"
          : truncated
            ? `前 ${results.length} 个会话（按最近修改排序）`
            : `${results.length} 个会话`;
  return (
    <div className="pinned-block session-hits">
      <div className="pinned-head">
        <span className="pinned-title">会话</span>
        {/* 搜索中（结果未落地）不亮 0 计数徽标，避免「会话 0」的误导 */}
        {results.length > 0 && <span className="pinned-count">{results.length}</span>}
      </div>
      <div className="search-status">{statusText}</div>
      <div className="pinned-list">
        {results.map((s) => (
          <SessionRow
            key={s.file}
            session={s}
            pinned={pinnedFiles.has(s.file)}
            active={s.file === activeSessionFile}
            projectName={projectNameOf(projects, s.projectPath)}
            highlight={keyword}
            onOpen={() => onOpenSession(s.projectPath, s)}
            onTogglePin={() => onTogglePin(s.projectPath, s.file)}
            onDelete={() => onDeleteSession(s.projectPath, s)}
            onContextMenu={(x, y) => onSessionContextMenu(x, y, s.projectPath, s)}
          />
        ))}
      </div>
      <div className="pinned-sep" />
    </div>
  );
}
