import { useCallback, useEffect, useRef, useState } from "react";
import { MODAL_EXIT_MS, useModalLayer } from "./Modal";
import { MarkdownText } from "./MessageParts";
import { ExternalLinkIcon, FileIcon, FileTextIcon, FolderIcon, XIcon } from "./Icons";
import { api } from "../lib/api";

/** 文件预览浮层的数据（解析/登记完成后才挂载，无加载态）：md 带正文，html 由
 *  iframe 直接经 ccpreview:// 从主进程按白名单供盘、不需要正文 */
export type FilePreviewState =
  | { kind: "md"; path: string; content: string }
  | { kind: "html"; path: string };

/** 本地路径 → ccpreview:// URL（与后端 preview-protocol.ts 的 toPreviewUrl 保持
 *  同构：host 固定 p，原路径按 / 分段逐段 encodeURIComponent——`D:` → `D%3A`；
 *  UNC 以哨兵段 `__ccunc__` 标记，否则前导 // 会被 URL 折叠丢掉 UNC 头）。
 *  相对资源按 URL 结构解析回同目录真实文件，主进程按登记的目录白名单供盘 */
function toPreviewUrl(absPath: string): string {
  const norm = absPath.replace(/\\/g, "/");
  const segs = norm.split("/").map((s) => encodeURIComponent(s));
  if (segs[0] === "" && segs[1] === "") {
    segs.shift();
    segs[0] = "__ccunc__";
  }
  return "ccpreview://p/" + segs.join("/");
}

/** 文件预览浮层（md/html）——ImageLightbox 同款交互契约：
 *  - 全屏深遮罩（.overlay.lightbox 同款，z 950），控件行让位自绘标题栏
 *    （top: titlebar+12，WCO 系统按钮之下）；
 *  - 关闭三条路：Esc（useModalLayer，不让「打断本轮」的全局 Esc 知情）/ 点遮罩 /
 *    右上按钮；出场先 .closing 播 MODAL_EXIT_MS 再卸载；
 *  - md 态复用会话 markdown 管线（MarkdownText，观感=会话观感），md 内的相对
 *    图片重写为 ccpreview:// 同目录地址（协议按目录白名单供盘，dev 的 http 父页
 *    也能加载——file:// 重写做不到这一点）；
 *  - html 态 = iframe src 直指 ccpreview://（非 srcDoc）：相对 css/js/图片能加载，
 *    storage shim 由主进程注入顶层文档；sandbox 保持无 allow-same-origin——
 *    opaque origin 碰不到父窗与 IPC 桥。 */
export default function FilePreviewOverlay({
  file,
  onToast,
  onClose,
}: {
  file: FilePreviewState;
  onToast: (msg: string) => void;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
    }, MODAL_EXIT_MS);
  }, []);

  // 出场那 ~110ms 里宿主换了预览目标（点开另一个文件）→ 出场态复位 + 清掉已排定
  // 的卸载定时器（不清它会触发 onClose 把刚打开的新预览关掉，ImageLightbox 同坑）
  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closingRef.current = false;
    setClosing(false);
  }, [file]);

  // 卸载兜底：父级直接清 state 时别让飞行中的定时器再回调
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  useModalLayer(close);

  // md 相对图片 → ccpreview:// 同目录绝对地址（render 后 DOM 重写，不动 MarkdownText
  // 的消毒管线）。⚠️ marked 会把 destination **主动 percent-encode**（`img/截图.png`
  // → `img/%E6%88%AA%E5%9B%BE.png`、`img/a b.png` → `img/a%20b.png`），而本链路是
  // 逐段 encodeURIComponent + 后端只解一层——先把 marked 的编码解回来再编码，否则
  // 中文/空格文件名全部 404。字面 % 文件名（真名就叫 `my%20pic.png`）会被解成空格
  // 名 miss——概率远低于转义引用，单次 decode 净收益。「/」开头的根相对路径不做。
  const mdBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (file.kind !== "md") return;
    const root = mdBodyRef.current;
    if (!root) return;
    const dir = file.path.replace(/[\\/][^\\/]*$/, "");
    for (const img of Array.from(root.querySelectorAll("img"))) {
      let src = img.getAttribute("src") ?? "";
      if (!src || src.startsWith("/")) continue;
      if (/^(?:https?|file|data|blob|ccpreview):/i.test(src)) continue;
      try {
        src = decodeURIComponent(src);
      } catch {
        /* 畸形 % 序列用原值 */
      }
      img.setAttribute("src", toPreviewUrl(dir + "/" + src));
    }
  }, [file]);

  const openBrowser = () => {
    api
      .openFile(file.path)
      .then((r) => {
        if (r.error) onToast(`打开失败：${r.error}`);
      })
      .catch((e) => onToast(`打开失败：${e instanceof Error ? e.message : String(e)}`));
  };

  const name = file.path.split(/[\\/]/).pop() ?? file.path;

  return (
    <div
      className={closing ? "overlay file-preview closing" : "overlay file-preview"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="fp-bar">
        <div className="fp-name">
          <span className="fp-kind">
            {file.kind === "html" ? <FileIcon size={14} /> : <FileTextIcon size={14} />}
          </span>
          <span className="fp-file">{name}</span>
          <span className="fp-path" title={file.path}>
            {file.path}
          </span>
        </div>
        <div className="fp-spacer" />
        {file.kind === "html" && (
          <button className="fp-btn fp-btn-text" onClick={openBrowser} title="用系统默认浏览器打开">
            <ExternalLinkIcon size={13} /> 浏览器打开
          </button>
        )}
        <button
          className="fp-btn fp-btn-text"
          title="在资源管理器中定位该文件"
          onClick={() => {
            api.revealFile(file.path).then(() => onToast("已在资源管理器中显示"));
          }}
        >
          <FolderIcon size={13} /> 资源管理器
        </button>
        <button className="fp-btn fp-icon-only" title="关闭（Esc）" onClick={close}>
          <XIcon size={15} />
        </button>
      </div>
      <div
        className="fp-stage"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        {file.kind === "md" ? (
          <div className="fp-md-card" ref={mdBodyRef}>
            <MarkdownText text={file.content} />
          </div>
        ) : (
          <div className="fp-html-card">
            {/* src 直指 ccpreview://（非 srcDoc）：相对资源按 URL 结构解析回同目录
                真实文件，由主进程按白名单供盘；storage shim 由主进程注入顶层文档。
                sandbox 保持无 allow-same-origin——opaque origin 碰不到父窗与 IPC 桥 */}
            <iframe
              sandbox="allow-scripts allow-forms"
              title="HTML 预览"
              src={toPreviewUrl(file.path)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
