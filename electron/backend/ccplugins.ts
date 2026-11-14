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
import { readEnabledPlugins, setPluginEnabled } from "./ccsettings";

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
  const [installedRaw, enabled, marketplacesRaw] = await Promise.all([
    readJsonObjectFile(installedPluginsPath(cfgDir)).catch(() => null),
    readEnabledPlugins(cfgDir),
    readJsonObjectFile(knownMarketplacesPath(cfgDir)).catch(() => null),
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

  // known_marketplaces.json：{ 名字: { source: { source, repo }, installLocation, lastUpdated } }
  const marketplaces: MarketplaceView[] = Object.entries(marketplacesRaw ?? {}).map(([name, v]) => {
    const m = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
    const source = (m.source && typeof m.source === "object" && !Array.isArray(m.source)
      ? m.source
      : {}) as Record<string, unknown>;
    return {
      name,
      sourceType: str(source.source),
      repo: str(source.repo),
      installLocation: str(m.installLocation),
      lastUpdated: str(m.lastUpdated),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

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
