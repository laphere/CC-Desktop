// ccpreview:// 自定义协议的后端：为文件预览浮层按目录白名单供本地文件。
//
// 为什么不用 srcDoc：沙箱 iframe（opaque origin）加载不了本地相对资源——非自包含
// 的源 html（<link href="x.css">）样式全丢。协议方案里 iframe 直接 src 指向
// ccpreview://，相对资源（css/js/img/fetch）按 URL 结构解析回同目录真实文件，
// 主进程读盘返回；自包含 packed 页与源文件两种形态都能完整渲染。
//
// 安全边界（渲染进程零 Node 权限的延伸）：
//  - **目录白名单**：只有显式登记过的根目录（= 被预览文件所在目录 + 其项目根）内
//    的文件可读，之外一律 403——原型页面即使伪造 ccpreview 请求也读不到项目外
//    的文件（config.json 等敏感文件不在项目树内）；项目内的符号链接指向根外
//    同样拒（realpath 复验），沙箱页面 fetch 不到；
//  - 白名单登记发生在渲染层显式预览动作时（用户点开预览才有），上限 16 个根、
//    超出淘汰最早的——一个运行周期内积累的面受控；
//  - 扩展名不做白名单：子资源（css/js/图片/字体/数据）形态无法枚举，边界由目录
//    白名单承担；可预览的**顶层文档**白名单（md/html/htm）在 preview_read/
//    preview_stat 里，本协议只服务 html 顶层文档。
//  - 顶层文档注入 storage shim 后返回；子资源一律原样。读盘走 promises API（大
//    子资源不阻塞主进程事件循环），读失败统一 404，任何畸形 URL 统一 400。
import * as fs from "node:fs";
import * as path from "node:path";

/** 协议名。注册特权在 main.ts（registerSchemesAsPrivileged 必须在 app ready 前） */
export const PREVIEW_SCHEME = "ccpreview";

/** 白名单根目录上限：超出淘汰最早登记的（登记只来自用户显式预览，量天然小）。
 *  ⚠️ 按**根**计而非按 key 计——符号链接根一个根占字面 + realpath 两个 key */
const MAX_ROOTS = 16;

/** 已登记的白名单根（FIFO）。win 大小写不敏感；符号链接根同时存字面 + realpath
 *  两套形态（登记时 realpath 可解析则双 key 都入索引，避免「字面根经链接落在真实
 *  位置」与 realpath 复验不相配导致整树 403） */
interface RootEntry {
  keys: string[];
  raw: string;
}
const rootList: RootEntry[] = [];
const rootKeyIndex = new Map<string, RootEntry>();

/** 近期预览过的顶层文档（normKey 集合，上限同 MAX_ROOTS）：shim 注入按它判定。
 *  多 tab 并存预览不同 html 时互不挤掉（单值 currentDoc 会被后登记者覆盖） */
const recentDocs = new Set<string>();

/** 规范化用于比较的路径形态（win 大小写不敏感、分隔符归一） */
function normKey(p: string): string {
  const s = path.normalize(p);
  return process.platform === "win32" ? s.toLowerCase() : s;
}

/** 一个根的形态集：字面形态 + realpath 形态（解析失败只留字面） */
function rootKeysOf(root: string): string[] {
  const keys = new Set<string>([normKey(root)]);
  try {
    keys.add(normKey(fs.realpathSync(root)));
  } catch {
    /* 目录尚不存在等：只留字面形态 */
  }
  return [...keys];
}

/** 登记白名单根 + 近期顶层文档。roots 覆盖「被预览文件所在目录 + 项目根」由渲染
 *  层拼好传入；根与文档各自 FIFO，超上限淘汰最早登记的。任一 key 已登记过的根
 *  保持原位不重排（「最早登记」不因重复预览漂移） */
export function registerPreviewRoots(docPath: string, rootsIn: string[]): void {
  const docKey = normKey(docPath);
  recentDocs.delete(docKey);
  recentDocs.add(docKey);
  if (recentDocs.size > MAX_ROOTS) {
    const oldest = recentDocs.values().next().value;
    if (oldest !== undefined) recentDocs.delete(oldest);
  }
  for (const r of rootsIn) {
    const keys = rootKeysOf(r);
    // 已登记的根跳过本根、继续处理后续（return 会把同一调用里排在其后的新根漏掉）
    if (keys.some((k) => rootKeyIndex.has(k))) continue;
    const entry: RootEntry = { keys, raw: path.normalize(r) };
    rootList.push(entry);
    for (const k of keys) rootKeyIndex.set(k, entry);
    while (rootList.length > MAX_ROOTS) {
      const oldest = rootList.shift();
      if (oldest) for (const k of oldest.keys) rootKeyIndex.delete(k);
    }
  }
}

/** 清空白名单（仅测试复位用；运行期靠上限淘汰收敛，无清空通道） */
export function clearPreviewRoots(): void {
  rootList.length = 0;
  rootKeyIndex.clear();
  recentDocs.clear();
}

/** 测试/诊断用：当前白名单快照（每根一条） */
export function previewRootsSnapshot(): string[] {
  return rootList.map((e) => e.raw);
}

/** ccpreview:// URL → 本地绝对路径；解析不出（形态不对）返回 null。
 *  URL 由渲染层 toPreviewUrl 生成：host 固定 "p"，pathname 为原路径按 "/" 分段
 *  逐段 encodeURIComponent 的结果（`D:` → `D%3A`），相对资源天然解析回同目录。
 *  UNC（`\\nas\share\...`）以哨兵段 `__ccunc__` 标记（字面目录名撞上概率≈0），
 *  否则前导 // 会被 URL 折叠丢掉 UNC 头。任何畸形编码（`%ZZ`、孤立代理对）都不
 *  抛——整体 400。 */
export function parsePreviewUrl(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== `${PREVIEW_SCHEME}:` || u.host !== "p") return null;
  const rawSegs = u.pathname.split("/").filter(Boolean);
  const segs: string[] = [];
  for (const s of rawSegs) {
    try {
      segs.push(decodeURIComponent(s));
    } catch {
      return null; // 畸形 percent 序列（%ZZ/裸 %/孤立代理对）
    }
  }
  if (segs.length === 0) return null;
  if (segs[0] === "__ccunc__") {
    return path.normalize("\\\\" + segs.slice(1).join("\\"));
  }
  if (/^[A-Za-z]:$/.test(segs[0])) {
    // Windows 盘符段：还原成 盘符\其余
    return path.normalize(segs[0] + "\\" + segs.slice(1).join("\\"));
  }
  // POSIX：绝对路径的 leading / 在 URL 里折叠掉了，还原
  return path.normalize("/" + segs.join("/"));
}

/** 本地绝对路径 → ccpreview:// URL（渲染层的 toPreviewUrl 与本函数保持同构） */
export function toPreviewUrl(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const segs = norm.split("/").map((s) => encodeURIComponent(s));
  // UNC：归一后以空段对开头（//nas/share），打上哨兵段再出栈空段
  if (segs[0] === "" && segs[1] === "") {
    segs.shift();
    segs[0] = "__ccunc__";
  }
  return `${PREVIEW_SCHEME}://p/` + segs.join("/");
}

/** 词法包含判定（小写归一比较，win 大小写不敏感） */
function lexicalInsideRoots(p: string): boolean {
  const key = normKey(p);
  for (const entry of rootList) {
    for (const rootKey of entry.keys) {
      const rel = path.relative(rootKey, key);
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return true;
    }
  }
  return false;
}

/** 白名单判定，三态：
 *  - "outside"：URL 词法路径在根外（与目标是否存在无关，统一 403），或词法在根内
 *    但 **realpath 在根外**——项目内的符号链接指向白名单外（如 ~/.ssh）同样拒，
 *    沙箱页面 fetch 不到；
 *  - "missing"：词法在根内但目标不存在/断链（上层 404）；
 *  - "ok"：词法与 realpath 都在根内。 */
function targetStatus(p: string): "ok" | "outside" | "missing" {
  if (!lexicalInsideRoots(p)) return "outside";
  let real: string;
  try {
    real = fs.realpathSync(p);
  } catch {
    return "missing";
  }
  if (!lexicalInsideRoots(real)) return "outside";
  return "ok";
}

/** 扩展名 → Content-Type（text 系带 charset；未知类型 octet-stream + nosniff） */
export function mimeFor(ext: string): string {
  const e = ext.toLowerCase();
  switch (e) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".eot":
      return "application/vnd.ms-fontobject";
    case ".txt":
    case ".xml":
      return "text/plain; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mp3":
      return "audio/mpeg";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

/** 沙箱 iframe 的 storage 内存 shim（opaque origin 一碰 storage 就抛 SecurityError，
 *  原型页常在顶层读）——只注入到近期预览的顶层 html 文档，子资源原样返回 */
const STORAGE_SHIM = `<script>(function(){function shim(n){try{window[n].getItem("__ccprobe__");}catch(e){var m={};var d={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null;},setItem:function(k,v){m[k]=String(v);},removeItem:function(k){delete m[k];},clear:function(){m={};},key:function(i){var ks=Object.keys(m);return i<ks.length?ks[i]:null;}};Object.defineProperty(d,"length",{get:function(){return Object.keys(m).length;}});Object.defineProperty(window,n,{configurable:true,value:d});}}shim("localStorage");shim("sessionStorage");})();</script>`;

function injectStorageShim(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + STORAGE_SHIM);
  return STORAGE_SHIM + html;
}

/** 协议请求入口（main.ts 的 protocol.handle 直接传本函数）。所有失败都不抛——
 *  返回带状态码的 Response，浏览器侧表现为资源加载失败，不炸浮层 */
export async function handlePreviewRequest(rawUrl: string): Promise<Response> {
  const notFound = (msg: string, status = 404) =>
    new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const target = parsePreviewUrl(rawUrl);
  if (!target) return notFound("bad preview url", 400);
  const status = targetStatus(target);
  if (status === "outside") return notFound("outside preview roots", 403);

  let st: fs.Stats;
  try {
    st = fs.statSync(target);
  } catch {
    return notFound("file not found");
  }
  if (!st.isFile()) return notFound("not a regular file", 403);

  const ext = path.extname(target).toLowerCase();
  try {
    // promises 读盘：大子资源不阻塞主进程事件循环（同步版会被反复 fetch 卡住）
    const buf = await fs.promises.readFile(target);
    const headers: Record<string, string> = {
      "Content-Type": mimeFor(ext),
      "Access-Control-Allow-Origin": "*", // 沙箱 opaque origin 的 fetch 需要显式放行
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store", // 预览的文件随时可能被改；白名单也随预览变化
    };
    // 近期预览的顶层 html 文档注入 storage shim（子资源原样）
    if (
      (ext === ".html" || ext === ".htm") &&
      recentDocs.has(normKey(target))
    ) {
      return new Response(injectStorageShim(buf.toString("utf8")), { headers });
    }
    return new Response(buf, { headers });
  } catch {
    return notFound("read failed");
  }
}
