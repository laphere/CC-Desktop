// 文本资产管理：技能（skills/）/ 子代理（agents/）/ 命令（commands/）与两级
// CLAUDE.md 的扫描、读写、删除（删 = 先搬数据根回收站，与会话删除同一条铁律）。
//
// 技能 = 目录 + SKILL.md（frontmatter 的 name/description 供列表展示）；子代理与
// 命令 = Markdown 文件（支持子目录，名字取相对路径去 .md，如 `frontend/ship`）。
// 插件自带的同名资源不在这里——它们归插件页管。
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { writeFileAtomic } from "./provider";
import { utcTimestamp } from "./trash";
import { validateProjectPath } from "./ccjson";

export type AssetKind = "skill" | "agent" | "command";
export type AssetScope = "user" | "project";

export interface AssetView {
  name: string;
  /** 文件绝对路径（skill = SKILL.md 的路径） */
  path: string;
  /** skill 才有：技能目录本身 */
  dir: string | null;
  /** SKILL.md / 条目 frontmatter 里的 description（没有则 null） */
  description: string | null;
  /** skill：目录本身是符号链接/联接（编辑写透至解析目标、删除只移链接，见
   *  movePathToTrash）；agent/command 恒为 false（递归扫描不跟进链接） */
  isLink: boolean;
  size: number;
  mtime: number;
}

// ---------------- 路径 ----------------

const KIND_DIR: Record<AssetKind, string> = { skill: "skills", agent: "agents", command: "commands" };

export function assetDir(kind: AssetKind, cfgDir: string, scope: AssetScope, projectPath: string | null): string {
  return scope === "user"
    ? path.join(cfgDir, KIND_DIR[kind])
    : path.join(requireProjectPath(projectPath), ".claude", KIND_DIR[kind]);
}

function requireProjectPath(p: string | null): string {
  if (!p) throw new Error("项目级资源需要 projectPath");
  return p;
}

// ---------------- 名字与路径安全 ----------------

/** Windows 保留设备名（不分区大小写；COM/LPT 带或不带序号）——做文件段会得到
 *  裸 ENOENT/EPERM 或被系统特殊解释，显式拒绝给出可读报错 */
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/** 名字按路径段校验：禁 ..、盘符/绝对路径、控制字符、冒号（NTFS ADS）、
 *  Windows 保留设备名、尾点尾空格；skill 只允许单段。
 *  返回相对段数组（agent/command 支持 `frontend/ship` 这类嵌套名）。 */
export function assetNameSegments(kind: AssetKind, name: string): string[] {
  const n = name.replace(/\\/g, "/").trim();
  if (!n || n.length > 200 || /[\u0000-\u001f]/.test(n)) throw new Error("名字不合法");
  if (n.includes(":")) throw new Error("名字不允许包含冒号（盘符 / NTFS 数据流）");
  const segs = n.split("/").filter((s) => s !== "");
  if (segs.length === 0) throw new Error("名字不合法");
  for (const s of segs) {
    if (s === "." || s === "..") throw new Error("名字不允许路径上跳（..）");
    if (RESERVED_NAMES.has(s.toLowerCase())) throw new Error(`名字不允许使用 Windows 保留设备名：${s}`);
    if (/[\s.]$/.test(s)) throw new Error("名字的段不允许以点或空格结尾（Windows 会丢弃）");
  }
  if (kind === "skill" && segs.length !== 1) throw new Error("技能名只能是单段目录名");
  return segs;
}

function skillFilePath(dir: string): string {
  return path.join(dir, "SKILL.md");
}

// ---------------- frontmatter ----------------

/** 极简 frontmatter 解析：只取顶层 `key: value` 行（够 name/description 用，
 *  不引 YAML 依赖）。非 frontmatter 文件返回 {}。 */
export function parseFrontmatter(md: string): Record<string, string> {
  if (!md.startsWith("---")) return {};
  const end = md.indexOf("\n---", 3);
  if (end < 0) return {};
  const out: Record<string, string> = {};
  for (const line of md.slice(3, end).split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k && v) out[k] = v;
  }
  return out;
}

// ---------------- 扫描 ----------------

function statOf(p: string): { size: number; mtime: number } {
  try {
    const st = fs.statSync(p);
    return { size: st.size, mtime: st.mtimeMs };
  } catch {
    return { size: 0, mtime: 0 };
  }
}

function listMarkdownRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // 符号链接不跟进（防环）；agent/command 都该是普通文件
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  };
  walk(root);
  return out;
}

function markdownDescription(p: string): string | null {
  try {
    const fm = parseFrontmatter(fs.readFileSync(p, "utf8"));
    return fm.description ?? null;
  } catch {
    return null;
  }
}

export async function listAssets(
  kind: AssetKind,
  cfgDir: string,
  scope: AssetScope,
  projectPath: string | null,
): Promise<AssetView[]> {
  const root = assetDir(kind, cfgDir, scope, projectPath);
  if (!existsDir(root)) return []; // 目录未创建 = 空态，不是错误

  if (kind === "skill") {
    const out: AssetView[] = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const dir = path.join(root, e.name);
      // 技能目录允许是符号链接 / Windows 联接（把共享技能目录链进 ~/.claude/skills
      // 是常见做法）：Dirent 对它们报 LINK 而非 DIR，isDirectory() 为 false，须按
      // 解析后的 stat 判定——existsDir 走 statSync 会跟进链接，悬空链接返回 false。
      // 技能只扫一层不递归，跟进链接没有 listMarkdownRecursive 那样的防环顾虑。
      if (!existsDir(dir)) continue;
      const sp = skillFilePath(dir);
      if (!existsFile(sp)) continue; // 有目录没 SKILL.md = 半成品，不列
      // 列表项区分链接目录（UI 据此提示写透）；existsDir 已确认解析目标是目录，
      // 这里只补记原始形态
      let isLink = false;
      try {
        isLink = fs.lstatSync(dir).isSymbolicLink();
      } catch {
        // 极端竞态下条目刚消失：按普通目录展示，读/写/删各有自己的存在性校验
      }
      const fm = (() => {
        try {
          return parseFrontmatter(fs.readFileSync(sp, "utf8"));
        } catch {
          return {} as Record<string, string>;
        }
      })();
      const { size, mtime } = statOf(sp);
      out.push({ name: e.name, path: sp, dir, description: fm.description ?? null, isLink, size, mtime });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const views = listMarkdownRecursive(root).map((p) => ({
    name: toRelName(root, p),
    path: p,
    dir: null,
    description: markdownDescription(p),
    isLink: false,
    ...statOf(p),
  }));
  return views.sort((a, b) => a.name.localeCompare(b.name));
}

function toRelName(root: string, p: string): string {
  return path.relative(root, p).replace(/\\/g, "/").slice(0, -".md".length);
}

function existsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// ---------------- 读 / 写 ----------------

export function readAssetFile(p: string): string {
  if (!existsFile(p)) throw new Error("条目不存在（可能已被删除）");
  return fs.readFileSync(p, "utf8");
}

/** 条目文件的绝对路径（读/写/删除共用一套定位；不校验存在性——存在性由具体操作管） */
export function assetFilePath(
  kind: AssetKind,
  cfgDir: string,
  scope: AssetScope,
  projectPath: string | null,
  name: string,
): string {
  const segs = assetNameSegments(kind, name);
  const root = assetDir(kind, cfgDir, scope, projectPath);
  return kind === "skill"
    ? skillFilePath(path.join(root, segs[0]))
    : path.join(root, ...segs) + ".md";
}

export function writeAsset(
  kind: AssetKind,
  cfgDir: string,
  scope: AssetScope,
  projectPath: string | null,
  name: string,
  content: string,
): string {
  const segs = assetNameSegments(kind, name);
  // 项目 scope 的写入口走同一道 projectPath 防线（绝对路径 + 真实存在目录），
  // 与 settings/MCP 的写路径一致——渲染层传来的 projectPath 运行时不能信
  if (scope === "project") validateProjectPath(projectPath);
  const root = assetDir(kind, cfgDir, scope, projectPath);
  const target =
    kind === "skill"
      ? skillFilePath(path.join(root, segs[0]))
      : path.join(root, ...segs) + ".md";
  if (existsDir(target)) throw new Error(`${target} 是目录，无法写成文件`);
  writeFileAtomic(target, content);
  return target;
}

// ---------------- 删除（进回收站） ----------------

/**
 * 通用搬移进回收站：`<trashRoot>/cc-assets/<时间戳-随机尾>/<kind>/<原名>`。
 * 时间戳是秒级粒度、名字取 basename——同秒删两个同名条目（用户/项目两 scope
 * 的同名技能、frontend/ship 与 backend/ship）会撞同一备份路径，因此目录名带
 * 随机尾保证唯一。rename 原子优先，跨卷回退 copy+remove（与
 * trash.deleteSessionFile 同策略）。返回备份绝对路径（未来做「恢复」入口时的锚点）。
 */
export function movePathToTrash(target: string, trashRoot: string, kind: AssetKind): string {
  if (!existsFile(target) && !existsDir(target)) throw new Error("目标不存在");
  const unique = `${utcTimestamp()}-${randomUUID().slice(0, 8)}`;
  const backup = path.join(trashRoot, "cc-assets", unique, kind, path.basename(target));
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  // 链接条目（技能目录允许符号链接 / Windows 联接）：只搬链接本身，绝不解析进
  // 目标——链接的解析目标（如 ~/.agents/skills 里的共享技能）不属于本 app 的删除
  // 范围，因此回收站里备份的也是链接而非内容副本（事后删掉共享源，备份会悬空）。
  // 链接跨卷 rename 必抛 EXDEV，且 cpSync(dereference:false) 回退在 Windows 上要
  // 创建裸符号链接（无管理员权限必 EPERM）——链接的回退是读链接目标原位重建
  // （目标按目录处理用联接，免管理员权限），不碰 cpSync。
  if (fs.lstatSync(target).isSymbolicLink()) {
    try {
      fs.renameSync(target, backup);
    } catch {
      try {
        fs.symlinkSync(fs.readlinkSync(target), backup, "junction");
      } catch (e) {
        throw new Error(`备份失败：${String(e)}`);
      }
      fs.rmSync(target, { recursive: true, force: true });
    }
    return backup;
  }
  try {
    fs.renameSync(target, backup);
  } catch {
    try {
      fs.cpSync(target, backup, { recursive: true });
    } catch (e) {
      throw new Error(`备份失败：${String(e)}`);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  return backup;
}

export function deleteAsset(
  kind: AssetKind,
  cfgDir: string,
  scope: AssetScope,
  projectPath: string | null,
  name: string,
  trashRoot: string,
): string {
  const segs = assetNameSegments(kind, name);
  // 删除同样是写操作（移走原位文件），走同一道 projectPath 防线
  if (scope === "project") validateProjectPath(projectPath);
  const root = assetDir(kind, cfgDir, scope, projectPath);
  const target =
    kind === "skill" ? path.join(root, segs[0]) : path.join(root, ...segs) + ".md";
  return movePathToTrash(target, trashRoot, kind);
}

// ---------------- CLAUDE.md ----------------

export interface ClaudeMdView {
  path: string;
  content: string;
  /** 文件不存在 = true（UI 显示「尚未创建，保存即创建」） */
  missing: boolean;
  /** 正文里的 @import 引用（只展示不改写；CLI 的 import 语法是行内 @path） */
  imports: string[];
}

/** @import 提取：取空白/行首后的 @token，要求像路径（含 / 或以 .md 结尾）。
 *  误报无害——只是提示 chips。 */
export function extractImports(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/(?:^|[\s(])@([\w~./\\-]+)/g)) {
    const t = m[1];
    if (t.includes("/") || t.endsWith(".md")) out.add(t);
  }
  return [...out];
}

export async function readClaudeMd(
  cfgDir: string,
  scope: AssetScope,
  projectPath: string | null,
): Promise<ClaudeMdView> {
  const p =
    scope === "user"
      ? path.join(cfgDir, "CLAUDE.md")
      : path.join(requireProjectPath(projectPath), "CLAUDE.md");
  if (!existsFile(p)) return { path: p, content: "", missing: true, imports: [] };
  const content = fs.readFileSync(p, "utf8");
  return { path: p, content, missing: false, imports: extractImports(content) };
}

export function writeClaudeMd(
  cfgDir: string,
  scope: AssetScope,
  projectPath: string | null,
  content: string,
): string {
  const p =
    scope === "user"
      ? path.join(cfgDir, "CLAUDE.md")
      : path.join(validateProjectPath(requireProjectPath(projectPath)), "CLAUDE.md");
  writeFileAtomic(p, content);
  return p;
}
