import { useEffect, useState } from "react";
import { PinIcon, TrashIcon } from "./Icons";

/** 确认态自动收回：变红后一直挂着，用户隔一阵回来误点一下就直接执行了（对齐回收站行内确认） */
const CONFIRM_REVERT_MS = 4000;

interface Props {
  /** 已置顶 → 图钉语义为「取消置顶」并点亮 */
  pinned: boolean;
  onTogglePin: () => void;
  /** 删除（移入回收站，可恢复）：确认态下再点一次才执行 */
  onDelete: () => void;
}

/** 会话行尾操作组：归档（删除）+ 置顶，默认隐藏，行 hover 才现形（见 styles.css）。
 *  两个按钮都是破坏/状态性操作，收进行尾避免挤占标题宽度；删除走行内二次确认
 *  （第一次点击变红显示「确认」，4s 无人点自动收回），确认即删入回收站。 */
export default function SessionRowActions({ pinned, onTogglePin, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_REVERT_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <div className="session-actions">
      {/* 归档 = 删除进回收站（可恢复），与右键菜单「删除」同一去向；
          行内两步确认替代模态框，警告信息由 deleteSession 的 toast 承担 */}
      <button
        className={`session-act session-del ${confirming ? "confirming" : ""}`}
        title={confirming ? "确认删除（移入回收站）" : "删除会话（移入回收站）"}
        onClick={(e) => {
          e.stopPropagation();
          if (confirming) {
            setConfirming(false);
            onDelete();
          } else {
            setConfirming(true);
          }
        }}
      >
        {confirming ? "确认" : <TrashIcon size={13} />}
      </button>
      <button
        className={`session-act session-pin ${pinned ? "on" : ""}`}
        title={pinned ? "取消置顶" : "置顶（在顶部聚合区常驻显示）"}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
      >
        <PinIcon />
      </button>
    </div>
  );
}
