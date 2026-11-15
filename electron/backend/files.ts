// 文件预览的后端读侧：路径解析 / 预览前探 / 读内容（扩展名白名单 + 大小上限）。
// shell.openPath / showItemInFolder 由 main.ts 直接调（Electron API，测试进不了），
// 这里只收口「读用户盘上的文件」——渲染层传来的任意路径都必须过这里的校验：
// 白名单顺带挡住 config.json 等敏感文件，超限挡住把渲染层当垃圾场的大文件。
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PREVIEW_EXTENSIONS, PREVIEW_MAX_BYTES } from "../ipc-contract";

/** 路径是否命中白名单扩展名（大小写不敏感） */
export function isPreviewablePath(p: string): boolean {
  const ext = path.extname(p).toLowerCase();
  return (PREVIEW_EXTENSIONS as readonly string[]).includes(ext);
}

/** 把渲染层传来的路径解析成可用的绝对路径：
 *  - `~` 展开为用户主目录（模型输出里的 macOS 风格路径常这么写）；
 *  - 相对路径（`docs/x.md`）佩上 base（= 会话的项目根）——绝对性按主进程所在
 *    平台判（path.isAbsolute），渲染层没有 path 模块也不该猜平台；
 *  - Windows 的「有根无盘」路径（`/x.md`、`\x.md`；反斜杠 UNC `\\srv\…` 不算）按
 *    base 相对拼接：fs 会把它锚到主进程 cwd 所在盘（`/tmp/x` 实际是 `D:\tmp\x`），
 *    而这种 POSIX 风格「绝对路径」多半来自其他平台的会话，落到项目根下更贴近
 *    意图；无 base 才按 rooted 原样归一（大概率 ENOENT，安全失败）。 */
export function resolveUserPath(p: string, base?: string): string {
  let s = p.trim();
  if (s === "~") return os.homedir();
  if (s.startsWith("~/") || s.startsWith("~\\")) s = path.join(os.homedir(), s.slice(2));
  if (path.isAbsolute(s)) {
    const rootedWithoutDrive =
      process.platform === "win32" && /^[\\/]/.test(s) && !s.startsWith("\\\\");
    if (!rootedWithoutDrive) return path.normalize(s);
    if (base) return path.normalize(path.join(base, s));
    return path.normalize(s);
  }
  if (base) return path.resolve(base, s);
  return s;
}

export interface PreviewStat {
  exists: boolean;
  isFile: boolean;
  size: number;
  /** 解析后的绝对路径（浮层标题 / 菜单「复制绝对路径」用它，渲染层无需再猜） */
  resolved: string;
}

/** 预览前探：存在性 + 常规文件 + 字节数。任何 fs 错误都归为「不存在」——
 *  点开瞬间文件被删等竞态不炸，真错误留给 preview_read 冒泡给渲染层展示 */
export function previewStat(p: string, base?: string): PreviewStat {
  const resolved = resolveUserPath(p, base);
  try {
    const st = fs.statSync(resolved); // stat 跟随符号链接：链接到常规文件同样可预览
    return { exists: true, isFile: st.isFile(), size: st.size, resolved };
  } catch {
    return { exists: false, isFile: false, size: 0, resolved };
  }
}

export interface PreviewReadResult {
  content: string;
  resolved: string;
}

/** 读预览内容。白名单外 / 非常规文件 / 超限一律 throw（IpcMain handle 统一转
 *  字符串错误 reject，渲染层 toast 直显中文原因） */
export function readPreviewFile(p: string, base?: string): PreviewReadResult {
  const resolved = resolveUserPath(p, base);
  if (!isPreviewablePath(resolved)) {
    throw new Error(`不支持的预览类型：${path.extname(resolved) || "（无扩展名）"}`);
  }
  const st = fs.statSync(resolved); // 不存在 → ENOENT 冒泡
  if (!st.isFile()) throw new Error("不是常规文件，无法预览");
  if (st.size > PREVIEW_MAX_BYTES) {
    const mb = Math.round(st.size / 1024 / 1024);
    const capMb = Math.round(PREVIEW_MAX_BYTES / 1024 / 1024);
    throw new Error(`文件约 ${mb}MB，超过预览上限 ${capMb}MB，请在资源管理器中打开`);
  }
  return { content: fs.readFileSync(resolved, "utf8"), resolved };
}
