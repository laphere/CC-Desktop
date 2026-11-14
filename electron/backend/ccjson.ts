// cc 系配置模块（插件/MCP/技能/权限）共用的 JSON 读底层。
//
// 这里读写的都是 Claude Code CLI 拥有的文件（settings.json / .claude.json /
// .mcp.json / installed_plugins.json……），CLI 会**整份回写**它们。因此：
// ① 读到的对象永远整体保留（写回时未知键逐字带回，见各模块的 mutate）；
// ② 读路径对「CLI 正在写的半份 JSON」要有韧性——短延迟重试一次再报错
//    （文件本身是好的，重试后拿到的多半是完整内容）；写路径 parse 失败即停；
// ③ 「读不到」与「文件缺失」必须区分：EBUSY/EPERM/EACCES（杀软瞬时锁、
//    OneDrive 占位符水合失败等）若被当成缺失，写路径就会拿 `{}` 起步、把整份
//    CLI 配置静默重置——只有 ENOENT 才允许返回 null。
import * as fs from "node:fs";
import * as path from "node:path";

/** 剥离 UTF-8 BOM（Windows 编辑器可能带 BOM 写入） */
function stripBom(raw: Buffer): Buffer {
  return raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? raw.subarray(3) : raw;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 读取 JSON 对象。**仅**文件缺失（ENOENT）返回 null；parse 失败与读失败
 *  （EBUSY/EPERM…）按 retries 重试（默认 1 次），仍失败抛可读错误——
 *  **绝不静默重置**：调用方拿 null 当「无配置」从 `{}` 起步写回，前提必须是
 *  「文件真的不存在」。 */
export async function readJsonObjectFile(
  p: string,
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<Record<string, unknown> | null> {
  const retries = opts.retries ?? 1;
  const delay = opts.retryDelayMs ?? 150;
  let lastErr: unknown = null;
  let lastWasParse = false;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(delay);
    let raw: Buffer;
    try {
      raw = fs.readFileSync(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      lastErr = e;
      lastWasParse = false;
      continue;
    }
    try {
      const parsed = JSON.parse(stripBom(raw).toString("utf8"));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      lastErr = new Error("内容不是 JSON 对象");
      lastWasParse = true;
    } catch (e) {
      lastErr = e;
      lastWasParse = true;
    }
  }
  if (lastWasParse) {
    throw new Error(
      `${p} 不是合法的 JSON 文件（可能正被 Claude Code 写入，可稍后重试）：${String(lastErr)}`,
    );
  }
  throw new Error(
    `${p} 读取失败（可能正被其他程序占用，可稍后重试）：${String(lastErr)}`,
  );
}

/**
 * `.claude.json` 的 projects 键定位：键是**原始路径**（CLI 落盘为正斜杠 resolve
 * 形式），且同一项目可能正/反斜杠双键并存。匹配规则：两侧分隔符归一（`\`→`/`）
 * 后比较，Windows 下再忽略大小写；命中返回**原键**（写回时用它，保住该键下
 * CLI 的其余状态字段）；无命中返回 null。
 */
export function matchProjectKey(
  projects: Record<string, unknown>,
  projectPath: string,
  caseFold: boolean = process.platform === "win32",
): string | null {
  return matchProjectKeys(projects, projectPath, caseFold)[0] ?? null;
}

/** 同 matchProjectKey，返回**全部**命中键（双键并存时读侧要合并展示）。 */
export function matchProjectKeys(
  projects: Record<string, unknown>,
  projectPath: string,
  caseFold: boolean = process.platform === "win32",
): string[] {
  const norm = (s: string) => {
    const slashed = s.replace(/\\/g, "/");
    return caseFold ? slashed.toLowerCase() : slashed;
  };
  const want = norm(projectPath);
  return Object.keys(projects).filter((key) => norm(key) === want);
}

/** projects 键的新建规范形式：resolve 后统一成正斜杠（与 CLI 本机落盘形式一致） */
export function canonicalProjectKey(projectPath: string): string {
  return path.resolve(projectPath).replace(/\\/g, "/");
}

/**
 * 项目 scope 写操作的 projectPath 防线：必须绝对路径且真实存在为目录。
 * 契约类型层面 projectPath 可选，运行时不能信——缺省/坏值在 main 层会被
 * String() 成 "undefined"，没有这道墙就会按 cwd 解析出垃圾键写进 CLI 文件。
 */
export function validateProjectPath(p: string | null | undefined): string {
  if (typeof p !== "string" || path.isAbsolute(p) === false) {
    throw new Error("projectPath 必须是绝对路径");
  }
  let isDir = false;
  try {
    isDir = fs.statSync(p).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new Error(`projectPath 不存在或不是目录：${p}`);
  return p;
}

/** 顺序无关的深比较（JSON 值语义；键序不同视为相等）。写路径的
 *  「内容没变就不落盘」守卫用它，避免无改动保存轮换掉 .bak。 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
  }
  return false;
}
