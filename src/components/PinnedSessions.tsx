import type { PinnedSessionInfo, Project, SessionInfo } from "../types";
import { projectNameOf } from "../lib/session-file";
import SessionRow from "./SessionRow";

interface Props {
  /** 后端按置顶清单顺序返回的置顶会话（未过滤） */
  items: PinnedSessionInfo[];
  /** 打开中的对话 tab 正显示的会话文件 */
  activeSessionFile: string | null;
  /** 项目清单：用于项目名徽标与失效判断 */
  projects: Project[];
  /** 点击 = 在 app 内继续该会话（打开/激活对话 tab） */
  onOpenSession: (projectPath: string, session: SessionInfo) => void;
  /** 取消置顶（置顶条目只存 jsonl 路径 + 项目路径，故传 file 而非整份元数据） */
  onTogglePin: (projectPath: string, file: string) => void;
  /** 删除会话（移入回收站）：行尾归档按钮确认后触发 */
  onDeleteSession: (projectPath: string, session: SessionInfo) => void;
  /** 会话行右键菜单（终端继续/重命名/取消置顶/删除收进菜单，行上不放按钮挤占标题宽度） */
  onSessionContextMenu: (x: number, y: number, projectPath: string, session: SessionInfo) => void;
}

/** 置顶会话聚合区：跨项目列出已置顶会话。没有置顶会话时整块不渲染。
 *  搜索期间整块让位给 SessionSearchResults（顶栏搜索已覆盖全局会话召回，这里
 *  不再自己过滤——两个作用域的会话结果重复显示只会打架）。 */
export default function PinnedSessions({
  items,
  activeSessionFile,
  projects,
  onOpenSession,
  onTogglePin,
  onDeleteSession,
  onSessionContextMenu,
}: Props) {
  if (items.length === 0) return null;
  return (
    <div className="pinned-block">
      <div className="pinned-head">
        <span className="pinned-title">置顶会话</span>
        <span className="pinned-count">{items.length}</span>
      </div>
      <div className="pinned-list">
        {items.map((s) => (
          <SessionRow
            key={s.file}
            session={s}
            pinned
            active={s.file === activeSessionFile}
            projectName={projectNameOf(projects, s.projectPath)}
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
