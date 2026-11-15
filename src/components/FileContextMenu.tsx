import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { CopyIcon, ExternalLinkIcon, EyeIcon, FolderIcon } from "./Icons";

/** 文件菜单的打开态（ChatView 持有）。path 是**解析后的绝对路径**——打开方
 *  （ccfile-menu 事件 / diff 卡头）都先经 previewStat 拿 resolved，不存在的路径
 *  在那一步就 toast 掉，菜单里不再处理死路径 */
export interface FileMenuState {
  path: string;
  x: number;
  y: number;
}

interface Props {
  open: boolean;
  menu: FileMenuState | null;
  onClose: () => void;
  /** 「预览」走宿主的浮层打开链路（stat → read → FilePreviewOverlay） */
  onPreview: (path: string) => void;
  onToast: (msg: string) => void;
}

/** 生成文件的操作菜单（消息里的路径 chip 右键 / diff 卡头 ⋯ 钮 / 变更文件抽屉右键）。
 *
 *  壳复用 .context-menu（常驻挂载 + data-open 开合，与项目/会话右键菜单同款：
 *  Esc 守卫的 document 级查询、进出场动画全部白拿）；条目按扩展名裁剪——
 *  「在浏览器中打开」只对 html 出（md 的默认程序多半是编辑器，不算浏览器），
 *  资源管理器用 showItemInFolder 定位并选中文件（不是打开父目录）。 */
export default function FileContextMenu({ open, menu, onClose, onPreview, onToast }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose 走 ref：宿主传的是内联箭头函数，放进 deps 会让全局监听每次渲染重挂
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!menu) return <div className="context-menu" data-open={false} ref={ref} />;

  const { path, x, y } = menu;
  const file = path.split(/[\\/]/).pop() ?? path;
  const isHtml = /\.html?$/i.test(path);

  const openWithDefault = () => {
    api
      .openFile(path)
      .then((r) => {
        if (r.error) onToast(`打开失败：${r.error}`);
      })
      .catch((e) => onToast(`打开失败：${e instanceof Error ? e.message : String(e)}`));
  };

  return (
    <div
      className="context-menu file-menu"
      data-open={open}
      ref={ref}
      // 防溢出预留：标题 + 4 条目 + 1 分隔线（含浏览器打开）时的包络
      style={{
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - 200),
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="context-title">
        <span className="context-title-text">{file}</span>
      </div>
      <div className="context-sep" />
      <button
        className="context-item"
        onClick={() => {
          onClose();
          onPreview(path);
        }}
      >
        <EyeIcon size={13} /> 预览
      </button>
      {isHtml && (
        <button
          className="context-item"
          onClick={() => {
            onClose();
            openWithDefault();
          }}
        >
          <ExternalLinkIcon size={13} /> 在浏览器中打开
        </button>
      )}
      <button
        className="context-item"
        onClick={() => {
          onClose();
          api.revealFile(path).then(() => onToast("已在资源管理器中显示"));
        }}
      >
        <FolderIcon size={13} /> 在资源管理器中显示
      </button>
      <div className="context-sep" />
      <button
        className="context-item"
        onClick={() => {
          onClose();
          api
            .writeClipboardText(path)
            .then(() => onToast("已复制"))
            .catch(() => onToast("复制失败，请重试"));
        }}
      >
        <CopyIcon size={13} /> 复制绝对路径
      </button>
    </div>
  );
}
