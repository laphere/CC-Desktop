import { useCallback, useEffect, useRef, useState } from "react";
import { MODAL_EXIT_MS, useModalLayer } from "./Modal";
import { MarkdownText } from "./MessageParts";
import { ExternalLinkIcon, FileIcon, FileTextIcon, FolderIcon, PanelLeftIcon, XIcon } from "./Icons";
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

/* ============ md 大纲（Typora 式左栏） ============ */

/** 大纲条目：level 是 heading 级数（1-6），indent 是按「层级 − 全文最小层级」
 *  归一后的缩进级数（build 时算好，渲染期直接用；封顶 4 级防超深标题顶满面板） */
type OutlineItem = { level: number; indent: number; text: string };

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/** 宽度阈值：≥1120 显示大纲、<1080 自动折叠、>1120 自动恢复（40px 迟滞带 +
 *  resize 80ms 防抖，口径照 App.tsx 左栏的 980/1020） */
const OUTLINE_COLLAPSE_BELOW = 1080;
const OUTLINE_EXPAND_ABOVE = 1120;

/** 大纲手动开合的会话级记忆（module 级：浮层关开、换文件都保留，不写 config）。
 *  true/false = 最近一次手动开/关；null = 无手动介入或已被自动态覆盖，跟随宽度 */
let outlineManual: boolean | null = null;

/** 文件预览浮层（md/html）——ImageLightbox 同款交互契约：
 *  - 全屏深遮罩（.overlay.lightbox 同款，z 950），控件行让位自绘标题栏
 *    （top: titlebar+12，WCO 系统按钮之下）；
 *  - 关闭三条路：Esc（useModalLayer，不让「打断本轮」的全局 Esc 知情）/ 点遮罩 /
 *    右上按钮；出场先 .closing 播 MODAL_EXIT_MS 再卸载；
 *  - md 态复用会话 markdown 管线（MarkdownText，观感=会话观感），md 内的相对
 *    图片重写为 ccpreview:// 同目录地址（协议按目录白名单供盘，dev 的 http 父页
 *    也能加载——file:// 重写做不到这一点）；
 *  - md 态另有左侧大纲面板（.fp-outline）：渲染后从 .md-body 收集 h1-h6 建树，
 *    点击平滑跳转、滚动 scrollspy 高亮；宽度不够自动折叠（阈值见上），顶栏
 *    PanelLeft 钮手动开合（手动态优先于自动）；
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

  /* ---------- md 大纲：状态与交互 ---------- */

  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  // 初始折叠态：手动记忆优先，否则按当前宽度判定（挂载即检一次）
  const [outlineCollapsed, setOutlineCollapsed] = useState(() => {
    if (outlineManual !== null) return !outlineManual;
    return window.innerWidth < OUTLINE_COLLAPSE_BELOW;
  });
  // 订阅/回调经 ref 取最新折叠态（App.tsx sidebarCollapsedRef 同款模式）
  const outlineCollapsedRef = useRef(outlineCollapsed);
  outlineCollapsedRef.current = outlineCollapsed;
  // 本次收起是否「自动」——只有自动收起才允许拉宽后自动恢复，手动介入即清
  const autoCollapsedRef = useRef(outlineManual === null && window.innerWidth < OUTLINE_COLLAPSE_BELOW);

  // .fp-md-card：滚动容器 + md 正文根（图片重写与大纲提取都在它里面查）
  const mdBodyRef = useRef<HTMLDivElement>(null);
  const outlineListRef = useRef<HTMLDivElement>(null);

  /** scrollspy 定当前章节：以「卡顶 + 96px」为参考线，取线上最后一个标题；
   *  滚到底强制点亮最后一项（末尾几节可能永远够不着参考线）。全用实时 rect——
   *  md 里的图片异步加载会移位，缓存 offsetTop 必然过期 */
  const updateActive = useCallback(() => {
    const card = mdBodyRef.current;
    if (!card) return;
    const headings = card.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR);
    if (headings.length === 0) return;
    const cardRect = card.getBoundingClientRect();
    const line = cardRect.top + 96;
    let idx = 0;
    headings.forEach((h, i) => {
      if (h.getBoundingClientRect().top <= line) idx = i;
    });
    if (card.scrollTop + card.clientHeight >= card.scrollHeight - 1) idx = headings.length - 1;
    setActiveIdx((prev) => (prev === idx ? prev : idx));
  }, []);

  // 滚动 rAF 节流：一帧最多算一次 active
  const spyTickRef = useRef(false);
  const onCardScroll = useCallback(() => {
    if (spyTickRef.current) return;
    spyTickRef.current = true;
    requestAnimationFrame(() => {
      spyTickRef.current = false;
      updateActive();
    });
  }, [updateActive]);

  const jumpTo = useCallback((idx: number) => {
    const card = mdBodyRef.current;
    if (!card) return;
    // 与大纲同序的 NodeList 取目标——不用 id 选择器：md 内原生 HTML 可能自带
    // 同名 id（DOMPurify 放行 id），按文档序会劫持命中
    const h = card.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)[idx];
    if (!h) return;
    const rect = h.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    card.scrollTo({ top: card.scrollTop + rect.top - cardRect.top - 44, behavior: "smooth" });
  }, []);

  // 折叠/展开后正文宽度重排（reflow 不触发滚动事件），过渡播完补一次 active 重估
  const scheduleActiveReestimate = useCallback(() => {
    window.setTimeout(updateActive, 260); // --dur-slow 240ms
  }, [updateActive]);

  const toggleOutline = useCallback(() => {
    const next = !outlineCollapsedRef.current;
    outlineManual = !next; // 记住最近一次手动选择（module 级，跨浮层开合保留）
    autoCollapsedRef.current = false; // 手动介入即清自动标记
    setOutlineCollapsed(next);
    scheduleActiveReestimate();
  }, [scheduleActiveReestimate]);

  // md 渲染后从 .md-body 收集标题建大纲（DOM 口径——marked 渲染的标题才进选择器，
  // 围栏代码块里的「# 注释」天然排除）。条目序 = NodeList 序，跳转/高亮都按同一下标
  useEffect(() => {
    if (file.kind !== "md") {
      setOutline([]);
      setActiveIdx(0);
      return;
    }
    const root = mdBodyRef.current;
    if (!root) return;
    const headings = Array.from(root.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR));
    if (headings.length === 0) {
      setOutline([]);
      return;
    }
    const minLevel = Math.min(...headings.map((h) => +h.tagName.slice(1)));
    setOutline(
      headings.map((h) => ({
        level: +h.tagName.slice(1),
        indent: Math.min(+h.tagName.slice(1) - minLevel, 4),
        text: (h.textContent ?? "").trim(),
      })),
    );
    setActiveIdx(0);
    if (outlineListRef.current) outlineListRef.current.scrollTop = 0; // 列表节点复用，清掉上一份文档的滚动位置
    requestAnimationFrame(updateActive);
  }, [file, updateActive]);

  // active 变化 → 大纲列表内居中跟随。手动算 scrollTop 而不用 scrollIntoView：
  // 后者会把所有可滚祖先（含 .fp-md-card）一起滚
  useEffect(() => {
    const list = outlineListRef.current;
    if (!list) return;
    const el = list.children[activeIdx] as HTMLElement | undefined;
    if (el) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;
  }, [activeIdx]);

  // ---------- 窗口过窄自动折叠大纲（照 App.tsx 左栏：迟滞带 + 80ms 防抖 +
  // 「只恢复被自动收起的那次」；大纲为空的文档不订阅） ----------
  useEffect(() => {
    if (outline.length === 0) return;
    let timer: number | undefined;
    const apply = () => {
      const w = window.innerWidth;
      if (w < OUTLINE_COLLAPSE_BELOW && !outlineCollapsedRef.current) {
        outlineManual = null; // 自动态接管，清手动记忆
        autoCollapsedRef.current = true;
        setOutlineCollapsed(true);
        scheduleActiveReestimate();
      } else if (w > OUTLINE_EXPAND_ABOVE && outlineCollapsedRef.current && autoCollapsedRef.current) {
        outlineManual = null;
        autoCollapsedRef.current = false;
        setOutlineCollapsed(false);
        scheduleActiveReestimate();
      }
    };
    const onResize = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(apply, 80);
    };
    apply();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [outline.length, scheduleActiveReestimate]);

  // md 相对图片 → ccpreview:// 同目录绝对地址（render 后 DOM 重写，不动 MarkdownText
  // 的消毒管线）。⚠️ marked 会把 destination **主动 percent-encode**（`img/截图.png`
  // → `img/%E5%9B%BE%E7%89%87.png`、`img/a b.png` → `img/a%20b.png`），而本链路是
  // 逐段 encodeURIComponent + 后端只解一层——先把 marked 的编码解回来再编码，否则
  // 中文/空格文件名全部 404。字面 % 文件名（真名就叫 `my%20pic.png`）会被解成空格
  // 名 miss——概率远低于转义引用，单次 decode 净收益。「/」开头的根相对路径不做。
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
        {file.kind === "md" && outline.length > 0 && (
          <button
            className={outlineCollapsed ? "fp-btn fp-icon-only" : "fp-btn fp-icon-only on"}
            title={outlineCollapsed ? "显示大纲" : "收起大纲"}
            aria-pressed={!outlineCollapsed}
            onClick={toggleOutline}
          >
            <PanelLeftIcon size={15} />
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
          <div
            className="fp-md-layout"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            {outline.length > 0 && (
              <aside
                className={outlineCollapsed ? "fp-outline collapsed" : "fp-outline"}
                aria-label="文档大纲"
              >
                <div className="fp-outline-inner" ref={outlineListRef}>
                  {outline.map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      className={i === activeIdx ? "fp-outline-item active" : "fp-outline-item"}
                      style={{ paddingLeft: 10 + item.indent * 14 }}
                      title={item.text}
                      aria-current={i === activeIdx ? "location" : undefined}
                      onClick={() => jumpTo(i)}
                    >
                      {item.text}
                    </button>
                  ))}
                </div>
              </aside>
            )}
            <div className="fp-md-card" ref={mdBodyRef} onScroll={onCardScroll}>
              <MarkdownText text={file.content} />
            </div>
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
