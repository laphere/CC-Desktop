/**
 * 会话正文里的**文件路径**可预览：识别 + 手势 + 事件路由。
 * 与 lib/links.ts（URL 补链）同款管线兄弟件，两条正则互不命中——URL 以 scheme 起头
 * 且不认盘符/反斜杠，这里只认带路径分隔符且以白名单扩展名结尾的串。
 *
 * 分三件事：
 *
 * 1) linkifyFilePaths —— 给 marked+DOMPurify 渲染出来的 HTML 包 `<a class="md-file-link">`。
 *    模型爱把生成文件的绝对路径塞进反引号（`D:\...\xxx.html`），也常写相对路径
 *    （`docs/x.md`）；DOM walk 只处理文本节点（inline code 也是文本节点），已在
 *    `<a>` 里（URL 补链 / markdown 链接）的不重复包。相对路径**不在此解析**——
 *    原样随事件冒泡，由持有项目根的 ChatView 解析（见 emitFilePreview 的 detail）。
 *
 * 2) installFileLinkGestures —— 全局装一次的捕获阶段委托（同 installCtrlLinkOpen 的
 *    「先于 React 合成事件」思路）：
 *      - 点击 = 预览（app 内浮层，安全首选）；
 *      - Ctrl+点击 = 系统默认程序打开（与外链 Ctrl 手势同款）；
 *      - 右键 = 文件菜单（stopPropagation 压过划选「复制」菜单）。
 *    芯片只出现在 markdown 渲染产物里、从不进 `<summary>`；diff 卡头路径是 React
 *    侧入口（MessageParts 的 DiffPathPart），它自己 preventDefault 拦 summary 原生
 *    展开，不走这里的委托。
 *
 * 3) 事件路由 —— 芯片由 dangerouslySetInnerHTML 生成、不经 React，用 CustomEvent
 *    冒泡（ccfile:*）而不是模块级回调注册：会话页可能同时保活多个 tab（display:none），
 *    事件只被**包含该芯片的那棵 ChatView 根**接住，天然不会串台。React 侧的入口
 *    （diff 卡头、变更文件抽屉）用 emitFilePreview / emitFileMenu 同样走冒泡。
 */
import { PREVIEW_EXTENSIONS } from "../../electron/ipc-contract";

/** 路径匹配：头部「到分隔符为止」+ 惰性主体 + 白名单扩展名 + 词边界。
 *  - 头部 `[^\s"'…]*[\\/]` 覆盖 盘符路径 / POSIX 绝对路径 / `~/` / 相对路径
 *    （都要求至少一个分隔符——裸文件名歧义太大，不做）；
 *  - 空白/反引号/引号/尖括号/竖线/`*?` 进不了路径（Windows 非法字符 + md 结构字符）；
 *    CJK 汉字放行——`方案/架构.md` 是合法相对路径，但**全角标点与 CJK 标点一律排除**
 *    （`（docs/b.md）` 的括号是行文包裹，不是路径）；
 *  - `\b` 挡住 `report.mds` 这类把扩展名当子串的误匹配，`report.md。` 的句号留在路
 *    径外（惰性主体在第一个「扩展名+词边界」处收口）；
 *  - 行文黏连（「路径在D:\x\a.md」无空格）会把前缀吃进匹配——wrapTextNode 里按
 *    盘符头再裁一次，其余形态不裁（对称性见 trimProsePrefix 的说明）。
 *  ⚠️ 扩展名白名单与主进程 ipc-contract 的 PREVIEW_EXTENSIONS 同步（识别面 ⊆ 可预览面） */
const PATH_RE_G =
  /[^\s"'`<>|*?\uFF01-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\u3000-\u303F\u2013-\u2014\u2018-\u201F\u2026]*[\\/][^\s"'`<>|*?\uFF01-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\u3000-\u303F\u2013-\u2014\u2018-\u201F\u2026]*?\.(?:md|html|htm)\b/gi;
/** 导出只为单测（matchAll 内部克隆 RegExp，共享 g 标志不动 lastIndex） */
export const PATH_RE = PATH_RE_G;

/** 绝对路径头：盘符。命中即认为匹配里的这一位起才是真路径（`/`、`~` 开头的
 *  匹配天然在 0 位，不需要裁） */
const ABS_HEAD = /[A-Za-z]:[\\/]/;

/** 裁掉行文黏进匹配前缀的部分，导出只为单测（links.ts 的 trimUrlTail 同例）：
 *  - 盘符黏连：「路径在D:\x\a.md」→「D:\x\a.md」；
 *  - ASCII 括号黏连：`(docs/b.md`（无配对右括号 = 行文包裹）→「docs/b.md」，
 *    配对的保留——带括号的目录名合法（裸 `(` 开头不会是真实目录名）；
 *  - POSIX 绝对与相对路径的黏连**不裁**：「详见/Users/x/a.md」的「详见」与
 *    「更新到方案/架构.md」的「方案」既可能是黏连也可能是真实目录名，不猜——
 *    这类死 chip 由点击时 stat 兜底 toast。盘符裁、其余不裁的不对称是有意的：
 *    盘符头是唯一能机器判定「这里开始才是路径」的形态 */
export function trimProsePrefix(m: string): string {
  let s = m;
  const head = ABS_HEAD.exec(s);
  if (head && head.index > 0) s = s.slice(head.index);
  if (s.startsWith("(") && !s.includes(")")) s = s.slice(1);
  return s;
}
/** 快速探针：整段 HTML 不含白名单扩展名时跳过 DOMParser（长会话免白付一遍解析） */
const PATH_PROBE = /\.(?:md|html|htm)\b/i;
/** 悬停提示：把手势一次讲全 */
const LINK_TITLE = "点击预览，右键更多操作，Ctrl+点击用系统默认程序打开";

function insideAnchor(node: Node): boolean {
  for (let p = node.parentElement; p; p = p.parentElement) {
    if (p.tagName === "A") return true;
  }
  return false;
}

/** 扩展名是否可预览（渲染层各入口共用；与主进程白名单同表） */
export function previewablePath(p: string): boolean {
  const m = /\.([a-z0-9]+)$/i.exec(p.trim());
  if (!m) return false;
  return (PREVIEW_EXTENSIONS as readonly string[]).includes("." + m[1].toLowerCase());
}

/** 把一个文本节点里的路径包成 chip（可能一段里有多个） */
function wrapTextNode(doc: Document, node: Text): void {
  const text = node.nodeValue ?? "";
  const matches = Array.from(text.matchAll(PATH_RE_G));
  if (matches.length === 0) return;
  const frag = doc.createDocumentFragment();
  let last = 0;
  for (const m of matches) {
    const raw = trimProsePrefix(m[0]);
    const start = (m.index ?? 0) + (m[0].length - raw.length);
    if (start > last) frag.appendChild(doc.createTextNode(text.slice(last, start)));
    const a = doc.createElement("a");
    a.className = "md-file-link";
    a.dataset.filePath = raw;
    a.setAttribute("title", LINK_TITLE);
    a.textContent = raw;
    frag.appendChild(a);
    last = start + raw.length;
  }
  if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
  node.parentNode?.replaceChild(frag, node);
}

/**
 * 给消毒后的 HTML 包路径 chip（MarkdownText 在 linkifyHtml 之后调用）。
 * 探针不命中时原样返回——绝大多数消息不含路径，免付 DOMParser 开销。
 */
export function linkifyFilePaths(html: string): string {
  if (!PATH_PROBE.test(html)) return html;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return html; // text/html 解析按规格不抛；防御性兜底
  }
  const body = doc.body;

  // 先收集再改树（TreeWalker 边走边改会乱）：不在 <a> 里的文本节点，
  // 含 inline code / 代码块——marked 不解析 code 内联，路径恰以纯文本躺在里面
  const pending: Text[] = [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const tag = node.parentElement?.tagName;
    if (tag === "STYLE" || tag === "SCRIPT") continue;
    if (!PATH_PROBE.test(node.nodeValue ?? "")) continue;
    if (insideAnchor(node)) continue;
    pending.push(node);
  }
  for (const node of pending) wrapTextNode(doc, node);

  return body.innerHTML;
}

// ---- 事件路由：芯片 → 所在 ChatView 根（CustomEvent 冒泡，见文件头注释 3） ----

const EVENT_PREVIEW = "ccfile-preview";
const EVENT_MENU = "ccfile-menu";
const EVENT_OPEN_DEFAULT = "ccfile-open-default";

export interface FileLinkEventDetail {
  /** 匹配到的原始路径文本（可能是相对路径，由 ChatView 佩上项目根再走 IPC） */
  path: string;
  /** 仅菜单事件：弹出坐标（视口系） */
  x?: number;
  y?: number;
}

/** 从 React 侧入口（diff 卡头路径 / 变更文件抽屉）发起预览 */
export function emitFilePreview(el: Element, path: string): void {
  el.dispatchEvent(new CustomEvent<FileLinkEventDetail>(EVENT_PREVIEW, {
    detail: { path },
    bubbles: true,
  }));
}

/** 从 React 侧入口发起文件菜单（坐标 = 触发点） */
export function emitFileMenu(el: Element, path: string, x: number, y: number): void {
  el.dispatchEvent(new CustomEvent<FileLinkEventDetail>(EVENT_MENU, {
    detail: { path, x, y },
    bubbles: true,
  }));
}

/** 从 React 侧入口发起「系统默认程序打开」（diff 卡头路径的 Ctrl+点击） */
export function emitFileOpenDefault(el: Element, path: string): void {
  el.dispatchEvent(new CustomEvent<FileLinkEventDetail>(EVENT_OPEN_DEFAULT, {
    detail: { path },
    bubbles: true,
  }));
}

function emit(el: Element, type: string, detail: FileLinkEventDetail): void {
  el.dispatchEvent(new CustomEvent<FileLinkEventDetail>(type, { detail, bubbles: true }));
}

let installed = false;

/** 装全局捕获委托（幂等；MessageParts.tsx 模块顶层调用）。手势语义见文件头注释 2。 */
export function installFileLinkGestures(): void {
  if (installed) return;
  installed = true;

  // 捕获阶段挂 document：先于 React 合成事件（芯片只在 markdown 渲染产物里，
  // 不进 <summary>——diff 卡头的路径是 React 侧入口，见文件头注释 2/3）
  document.addEventListener(
    "click",
    (e) => {
      if (!(e instanceof MouseEvent)) return;
      const a = e.target instanceof Element ? e.target.closest("a.md-file-link") : null;
      if (!a) return;
      e.preventDefault(); // 芯片命中时不留默认行为（<a> 无 href，防的是滚动到锚点一类）
      e.stopPropagation(); // 别让划选右键之外的任何上层逻辑看到这次点击
      const raw = (a as HTMLAnchorElement).dataset.filePath ?? a.textContent ?? "";
      emit(a, e.ctrlKey ? EVENT_OPEN_DEFAULT : EVENT_PREVIEW, { path: raw });
    },
    true,
  );
  document.addEventListener(
    "contextmenu",
    (e) => {
      if (!(e instanceof MouseEvent)) return;
      const a = e.target instanceof Element ? e.target.closest("a.md-file-link") : null;
      if (!a) return;
      e.preventDefault(); // 压过系统菜单
      e.stopPropagation(); // 压过划选「复制」菜单（.chat-body 的 onContextMenu）
      const raw = (a as HTMLAnchorElement).dataset.filePath ?? a.textContent ?? "";
      emit(a, EVENT_MENU, { path: raw, x: e.clientX, y: e.clientY });
    },
    true,
  );
}
