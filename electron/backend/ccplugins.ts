// 插件列表视图与启停开关（Phase 1 只读安装状态 + 布尔启停；安装/更新/卸载在
// Phase 2 走 `claude plugin` CLI，克隆/下载/缓存由 CLI 全包，这里不碰它的目录布局）。
//
// 数据源两处取**并集**：installed_plugins.json（v2：已装插件记录）与用户
// settings.json 的 enabledPlugins（布尔表）。官方内置 marketplace（如
// anthropic-agent-skills）的插件只有 enabledPlugins 条目、没有安装记录——列表若
// 只读 installed_plugins.json 会漏掉它们。
import * as fs from "node:fs";
import * as path from "node:path";
import { readJsonObjectFile } from "./ccjson";
import { readEnabledPlugins, readExtraKnownMarketplaces, setPluginEnabled } from "./ccsettings";
import { runClaude } from "./cccli";

export interface PluginView {
  /** 形如 `code-review@claude-plugins-official` */
  id: string;
  name: string;
  marketplace: string;
  enabled: boolean;
  /** installed_plugins.json 里有记录；false = 仅 enabledPlugins 条目（内置 marketplace 按需装载） */
  installed: boolean;
  version: string | null;
  scope: string | null;
  installPath: string | null;
  /** installPath 在磁盘上还存在（外部清理过会变 false，UI 标「缺失」） */
  installPathExists: boolean;
  installedAt: string | null;
  lastUpdated: string | null;
}

export interface MarketplaceView {
  name: string;
  sourceType: string | null;
  repo: string | null;
  installLocation: string | null;
  lastUpdated: string | null;
}

export interface PluginListView {
  plugins: PluginView[];
  marketplaces: MarketplaceView[];
}

function installedPluginsPath(cfgDir: string): string {
  return path.join(cfgDir, "plugins", "installed_plugins.json");
}

function knownMarketplacesPath(cfgDir: string): string {
  return path.join(cfgDir, "plugins", "known_marketplaces.json");
}

interface InstallRecord {
  scope?: unknown;
  installPath?: unknown;
  version?: unknown;
  installedAt?: unknown;
  lastUpdated?: unknown;
  [k: string]: unknown;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export async function listPlugins(cfgDir: string): Promise<PluginListView> {
  const [installedRaw, enabled, marketplacesRaw, extraKnown] = await Promise.all([
    readJsonObjectFile(installedPluginsPath(cfgDir)).catch(() => null),
    readEnabledPlugins(cfgDir),
    readJsonObjectFile(knownMarketplacesPath(cfgDir)).catch(() => null),
    readExtraKnownMarketplaces(cfgDir).catch(() => ({})),
  ]);

  // installed_plugins.json 的 v2 结构：{ version: 2, plugins: { "id@mkt": [记录…] } }
  const installed =
    installedRaw?.plugins && typeof installedRaw.plugins === "object" && !Array.isArray(installedRaw.plugins)
      ? (installedRaw.plugins as Record<string, unknown>)
      : {};

  const ids = new Set<string>([...Object.keys(installed), ...Object.keys(enabled)]);
  const plugins: PluginView[] = [...ids]
    .map((id) => {
      const records = Array.isArray(installed[id]) ? (installed[id] as InstallRecord[]) : [];
      const rec = records[0] ?? null;
      const installPath = rec ? str(rec.installPath) : null;
      const at = id.indexOf("@");
      return {
        id,
        name: at > 0 ? id.slice(0, at) : id,
        marketplace: at > 0 ? id.slice(at + 1) : "",
        enabled: enabled[id] === true,
        installed: records.length > 0,
        version: rec ? str(rec.version) : null,
        scope: rec ? str(rec.scope) : null,
        installPath,
        installPathExists: installPath ? existsDir(installPath) : false,
        installedAt: rec ? str(rec.installedAt) : null,
        lastUpdated: rec ? str(rec.lastUpdated) : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  // marketplace 两处取并集：本地登记（字段全）+ settings 声明（补 source）
  const marketplaces = mergeMarketplaces(marketplacesRaw, extraKnown);

  return { plugins, marketplaces };
}

function existsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 启停插件：只翻 enabledPlugins 布尔位（见 ccsettings.setPluginEnabled） */
export function togglePlugin(cfgDir: string, pluginId: string, enabled: boolean): Promise<void> {
  return setPluginEnabled(cfgDir, pluginId, enabled);
}

// ---------------- 插件详情（只读 CLI：claude plugin details）----------------

export interface PluginComponent {
  label: string;
  count: number;
}

export interface PluginDetails {
  name: string | null;
  version: string | null;
  description: string | null;
  source: string | null;
  components: PluginComponent[];
  /** `Always-on: ~N tok …` 那一行的值（无则 null） */
  tokenAlwaysOn: string | null;
  /** token 成本段的其余行（按工具/技能逐项列出时） */
  tokenLines: string[];
  /** 失败原因（超时/非零退出且无 stdout）；成功为 null */
  error: string | null;
  /** CLI 原始输出，UI 折叠展示（解析不出时是唯一可见内容） */
  raw: string;
}

const EMPTY_DETAILS: PluginDetails = {
  name: null,
  version: null,
  description: null,
  source: null,
  components: [],
  tokenAlwaysOn: null,
  tokenLines: [],
  error: null,
  raw: "",
};

/**
 * 解析 `claude plugin details <name>` 的文本输出。**容错优先**：认不出的行直接跳过，
 * 整段解析不出来时调用方还有 `raw` 可显示——CLI 升级改了格式不该让界面报错。
 * 实测形状（2.1.325）：
 * ```
 * claude-hud 0.7.0
 *   Description: …
 *   Source: claude-hud@claude-hud
 * Component inventory
 *   Skills (0)
 *   MCP servers (0)
 * Projected token cost
 *   Always-on:   ~0 tok   added to every session
 * ```
 */
export function parsePluginDetails(text: string): PluginDetails {
  const raw = text.trim();
  const lines = raw.split(/\r?\n/);
  let name: string | null = null;
  let version: string | null = null;
  let description: string | null = null;
  let source: string | null = null;
  const components: PluginComponent[] = [];
  let tokenAlwaysOn: string | null = null;
  const tokenLines: string[] = [];
  let section = "";

  for (const line of lines) {
    const indented = line.startsWith(" ") || line.startsWith("\t");
    const t = line.trim();
    if (t === "") continue;

    if (!indented) {
      // 顶层行：首个是「名字 版本」，其后是各段标题
      if (t === "Component inventory") {
        section = "components";
        continue;
      }
      if (t === "Projected token cost") {
        section = "token";
        continue;
      }
      if (name === null) {
        const m = t.match(/^(\S+)(?:\s+(\S+))?$/);
        if (m) {
          name = m[1];
          version = m[2] ?? null;
        }
      }
      section = "";
      continue;
    }

    if (t.startsWith("Description:")) {
      description = t.slice("Description:".length).trim();
      continue;
    }
    if (t.startsWith("Source:")) {
      source = t.slice("Source:".length).trim();
      continue;
    }
    if (section === "components") {
      const m = t.match(/^(.+?)\s+\((\d+)\)$/);
      if (m) components.push({ label: m[1].trim(), count: Number(m[2]) });
      continue;
    }
    if (section === "token") {
      if (t.startsWith("Always-on:")) tokenAlwaysOn = t.slice("Always-on:".length).trim();
      else tokenLines.push(t);
    }
  }

  return { ...EMPTY_DETAILS, name, version, description, source, components, tokenAlwaysOn, tokenLines, raw };
}

/** 查插件详情（组件清单 + projected token cost）。失败不抛，原因进 `error` + `raw`。 */
export async function pluginDetails(name: string): Promise<PluginDetails> {
  const r = await runClaude(["plugin", "details", name]);
  if (r.timedOut) {
    return { ...EMPTY_DETAILS, error: "查询超时", raw: [r.stdout, r.stderr].filter(Boolean).join("\n") };
  }
  const out = r.stdout || r.stderr;
  if (r.code !== 0 && !r.stdout) {
    return { ...EMPTY_DETAILS, error: `退出码 ${r.code ?? "未知"}`, raw: r.stderr };
  }
  return parsePluginDetails(out);
}

// ---------------- marketplace 数据源并集 ----------------

/** `known_marketplaces.json`（本地登记，含 installLocation/lastUpdated）与
 *  `settings.json → extraKnownMarketplaces`（声明，仅 source）按名合并。
 *  known 条目优先（字段全），settings 只补 source 字段；两边都没有的字段留 null。
 *  纯函数，单测覆盖。 */
export function mergeMarketplaces(
  knownRaw: Record<string, unknown> | null,
  extra: Record<string, unknown>,
): MarketplaceView[] {
  const merged = new Map<string, MarketplaceView>();
  const srcOf = (v: unknown): { sourceType: string | null; repo: string | null } => {
    const m = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
    const source = (m.source && typeof m.source === "object" && !Array.isArray(m.source)
      ? m.source
      : {}) as Record<string, unknown>;
    return { sourceType: str(source.source), repo: str(source.repo) };
  };

  for (const [name, v] of Object.entries(knownRaw ?? {})) {
    const m = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
    merged.set(name, {
      name,
      ...srcOf(v),
      installLocation: str(m.installLocation),
      lastUpdated: str(m.lastUpdated),
    });
  }
  for (const [name, v] of Object.entries(extra)) {
    const { sourceType, repo } = srcOf(v);
    const cur = merged.get(name);
    if (cur) merged.set(name, { ...cur, sourceType: cur.sourceType ?? sourceType, repo: cur.repo ?? repo });
    else merged.set(name, { name, sourceType, repo, installLocation: null, lastUpdated: null });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------- 写操作（marketplace 管理 / 插件卸载，走 CLI）----------------

export interface CliOutcome {
  ok: boolean;
  message: string | null;
  failureCode: string | null;
  /** CLI 原始输出（含人类可读消息），供展示与排障 */
  raw: string;
}

/** 解析 `claude plugin ... --json` 的输出：**一行紧凑 JSON**，但与人类可读消息的先后
 *  顺序不固定——实测 marketplace update 成功只有 JSON 一行，uninstall 失败是「JSON 在前、
 *  ✘ 消息在后」，install 则是「消息在前、JSON 在后」。故逐行找**能 parse 且含
 *  outcome/command** 的那条，不依赖位置。解析失败按失败返回（原文进 message/raw），
 *  不抛——命令失败不该让界面崩。 */
export function parseCliJsonLine(text: string): CliOutcome {
  const raw = text.trim();
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      if (typeof o["outcome"] !== "string" && typeof o["command"] !== "string") continue;
      return {
        ok: o["outcome"] === "ok",
        message: typeof o["message"] === "string" ? o["message"] : null,
        failureCode: typeof o["failureCode"] === "string" ? o["failureCode"] : null,
        raw,
      };
    } catch {
      // 该行不是合法 JSON（或被截断），继续找下一行
    }
  }
  return { ok: false, message: raw || "无输出", failureCode: null, raw };
}

/** 把 CLI message 里的换行折成单行（toast 是单行短句容器，完整原文在 raw 里可查） */
export function oneLine(s: string | null): string | null {
  if (s === null) return null;
  const folded = s.replace(/\s*\r?\n\s*/g, " ").trim();
  return folded || null;
}

async function runPluginCli(args: string[]): Promise<CliOutcome> {
  const r = await runClaude(args);
  const text = [r.stdout, r.stderr].filter(Boolean).join("\n");
  if (r.timedOut) return { ok: false, message: "命令超时", failureCode: null, raw: text };
  return parseCliJsonLine(text);
}

/** 添加 marketplace（source 可以是 owner/repo、git/https URL 或本地路径）。
 *  ⚠️ CLI 会拉取外部仓库并写 `settings.json → extraKnownMarketplaces`，调用方必须二次确认。 */
export function addMarketplace(source: string): Promise<CliOutcome> {
  return runPluginCli(["plugin", "marketplace", "add", source, "--json"]);
}

/** 移除 marketplace（同时清掉各 settings 里的声明与 enabledPlugins 条目）——破坏性。 */
export function removeMarketplace(name: string): Promise<CliOutcome> {
  return runPluginCli(["plugin", "marketplace", "remove", name, "--json"]);
}

/** 更新 marketplace（不传名字 = 更新全部）；从源重新拉取克隆。 */
export function updateMarketplace(name?: string): Promise<CliOutcome> {
  return runPluginCli(["plugin", "marketplace", "update", ...(name ? [name] : []), "--json"]);
}

/** 卸载插件。⚠️ 从磁盘删除安装体——破坏性；`--json` 与 `--prune` 互斥故不暴露 prune。 */
export function uninstallPlugin(
  plugin: string,
  opts: { keepData?: boolean } = {},
): Promise<CliOutcome> {
  return runPluginCli([
    "plugin",
    "uninstall",
    plugin,
    "--json",
    "-y",
    ...(opts.keepData ? ["--keep-data"] : []),
  ]);
}
