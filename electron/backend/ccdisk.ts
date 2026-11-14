// ~/.claude 数据目录的分桶磁盘用量统计（设置中心「磁盘占用」页 + 健康检查弹窗）。
//
// 全量走查 + 进程内 10 分钟缓存：目录里有几万个会话快照文件时 stat 一轮要秒级，
// 弹窗打开即拉不该每次都付这个代价。走查不跟进符号链接/junction（防环与重复计数）。
import * as fs from "node:fs";
import * as path from "node:path";
import { claudeProjectsDir } from "./paths";

export interface DiskBucket {
  name: string;
  size: number;
  note?: string;
}

export interface DiskUsage {
  total: number;
  buckets: DiskBucket[];
  /** 缓存生成时间（epoch ms）；前端可据此显示「统计于 x 分钟前」 */
  computedAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE = new Map<string, DiskUsage>();

/** 清空用量缓存（单测用） */
export function resetDiskUsageCache(): void {
  CACHE.clear();
}

/** 目录树字节数（apparent size）；root 缺失 = 0。符号链接一律跳过。 */
function treeSize(root: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) total += treeSize(full);
    else if (e.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        /* 瞬态消失不计 */
      }
    }
  }
  return total;
}

function fileSize(p: string): number {
  try {
    const st = fs.statSync(p);
    return st.isFile() ? st.size : 0;
  } catch {
    return 0;
  }
}

function treeSizeNoOverlap(root: string, exclude: string[]): number {
  // 「其余杂项」桶：整棵树走查、每层都跳过已单列的子树。exclude 传绝对路径集合；
  // 排除必须**逐层**做——只在顶层判会让 plugins 这类「部分子树已单列」的目录
  // 在递归里被重复计数（cache/marketplaces 会灌回 other）。
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(root, e.name);
    if (exclude.some((x) => samePath(x, full))) continue;
    if (e.isDirectory()) total += treeSizeNoOverlap(full, exclude);
    else if (e.isFile()) total += fileSize(full);
  }
  return total;
}

function samePath(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
  return norm(a) === norm(b);
}

export async function diskUsage(
  cfgDir: string,
  appRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DiskUsage> {
  // 缓存键带上 appRoot：cc-assets 桶取自数据根，两个入参任一不同都不是同一份统计
  const cacheKey = `${cfgDir}\u0000${appRoot}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.computedAt < CACHE_TTL_MS) return hit;

  const projectsDir = claudeProjectsDir(process.platform, env);
  const sub = (...p: string[]) => path.join(cfgDir, ...p);

  const buckets: DiskBucket[] = [];
  const push = (name: string, size: number, note?: string) => buckets.push({ name, size, note });

  // 会话数据桶按 projects 目录实际位置算（CLAUDE_CONFIG_DIR 用户它就在 cfgDir 内）
  push("sessions", treeSize(projectsDir), "会话 jsonl（删除/清理请走回收站，可恢复）");
  push("file-history", treeSize(sub("file-history")), "每轮对话的文件快照，「撤销本轮改动」依赖它");
  push("plugin-cache", treeSize(sub("plugins", "cache")), "插件安装体（各版本）");
  push("marketplaces", treeSize(sub("plugins", "marketplaces")), "marketplace 仓库的本地克隆");
  push("paste-cache", treeSize(sub("paste-cache")));
  push("plans", treeSize(sub("plans")));
  push("history-jsonl", fileSize(sub("history.jsonl")), "提示词历史");
  // cc-assets 回收站在 app 数据根（不在 ~/.claude），单独一桶
  push("cc-assets-trash", treeSize(path.join(appRoot, "trash", "cc-assets")), "设置中心删除的技能/子代理/命令备份");

  const counted = [
    projectsDir,
    sub("file-history"),
    sub("plugins", "cache"),
    sub("plugins", "marketplaces"),
    sub("paste-cache"),
    sub("plans"),
    sub("history.jsonl"),
  ];
  push("other", treeSizeNoOverlap(cfgDir, counted), "其余数据（缓存/指标/会话环境/旧备份等）");

  const usage: DiskUsage = {
    total: buckets.reduce((s, b) => s + b.size, 0),
    buckets,
    computedAt: Date.now(),
  };
  CACHE.set(cacheKey, usage);
  return usage;
}
