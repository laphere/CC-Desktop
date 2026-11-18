// Claude Code 用户级/项目级 settings.json 的读改写（权限规则 / Hooks / 插件启停 /
// defaultMode 生效链）。设置中心管理面的「配置文件」域都走这里。
//
// 写入统一走 read → mutate → 原子写：settings.json 同时被供应商切换（整文件替换）、
// CLI 会话内改档位等多方读写，这里每次只改自己负责的键（allow/deny/ask、hooks、
// enabledPlugins），其余键（env、模型映射……）从磁盘最新内容原样带回。
import * as path from "node:path";
import { claudeSettingsPathFrom, writeJsonAtomic } from "./provider";
import { readJsonObjectFile, deepEqual, validateProjectPath } from "./ccjson";

/** 管理面 scope：用户级（~/.claude）与项目级（<项目>/.claude）。
 *  settings.local.json 不进管理 UI，只在 defaultMode 生效链里参与判定。 */
export type CcScope = "user" | "project";

/** 项目级配置目录：<项目>/.claude（写入时按需创建） */
export function projectClaudeDir(projectPath: string): string {
  return path.join(projectPath, ".claude");
}

function projectSettingsPath(projectPath: string, name: string): string {
  return path.join(projectClaudeDir(projectPath), name);
}

/** scope → settings 文件路径。project scope 只认 settings.json（local 文件 v1 不写）。
 *  ⚠️ 这里**不做** projectPath 校验：读路径（规则列表 / defaultMode 生效链）要对
 *  stale 项目（目录已删但清单里还挂着）优雅降级成空配置；校验只在**写**入口做。 */
export function settingsPathFor(
  scope: CcScope,
  cfgDir: string,
  projectPath: string | null,
  variant: "settings" | "local" = "settings",
): string {
  if (scope === "user") {
    return variant === "local"
      ? path.join(cfgDir, "settings.local.json")
      : claudeSettingsPathFrom(cfgDir);
  }
  if (!projectPath) throw new Error("项目级配置需要 projectPath");
  return projectSettingsPath(projectPath, variant === "local" ? "settings.local.json" : "settings.json");
}

async function readSettings(p: string): Promise<Record<string, unknown>> {
  return (await readJsonObjectFile(p)) ?? {};
}

/** 读改写一个 settings 文件。mutate 在最新磁盘内容上跑；改后与改前深比较，
 *  **内容没变就不落盘**——无改动保存不能轮换 .bak（.bak 是覆盖前的唯一退路，
 *  与 provider.writeLiveIfChanged 同一条原则）。
 *  ⚠️ 深拷贝后再交 mutate：settings 是嵌套对象，浅拷贝会让 mutate 改到
 *  before 的同一引用，深比较恒等 → 永远跳过写盘。 */
async function mutateSettings(
  p: string,
  mutate: (obj: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  const before = await readSettings(p);
  const obj = JSON.parse(JSON.stringify(before)) as Record<string, unknown>;
  mutate(obj);
  if (!deepEqual(before, obj)) writeJsonAtomic(p, obj);
  return obj;
}

// ---------------- 权限规则（permissions） ----------------

/** UI 面的权限规则三组 + additionalDirectories（只读展示；写只覆盖三组，
 *  defaultMode / additionalDirectories / CLI 的其他键原样保留） */
export interface PermissionRules {
  allow: string[];
  deny: string[];
  ask: string[];
  additionalDirectories?: string[];
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function readRules(perms: unknown): PermissionRules {
  const p = perms && typeof perms === "object" && !Array.isArray(perms)
    ? (perms as Record<string, unknown>)
    : {};
  return {
    allow: asStringArray(p.allow),
    deny: asStringArray(p.deny),
    ask: asStringArray(p.ask),
    additionalDirectories: asStringArray(p.additionalDirectories),
  };
}

/** 读某 scope 的权限规则（文件缺失 = 空规则） */
export async function readPermissionRules(
  scope: CcScope,
  cfgDir: string,
  projectPath: string | null,
): Promise<PermissionRules> {
  const obj = await readSettings(settingsPathFor(scope, cfgDir, projectPath));
  return readRules(obj.permissions);
}

/** 写某 scope 的权限规则：只覆盖 allow/deny/ask 三组，permissions 下的其余键
 *  （defaultMode、additionalDirectories、CLI 自己写的任何键）原样保留 */
export async function writePermissionRules(
  scope: CcScope,
  cfgDir: string,
  projectPath: string | null,
  rules: PermissionRules,
): Promise<PermissionRules> {
  // 项目 scope 写入口校验（读路径不校验——stale 项目要能优雅降级为空规则）
  if (scope === "project") validateProjectPath(projectPath);
  for (const v of [rules.allow, rules.deny, rules.ask]) {
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new Error("权限规则必须是字符串数组");
    }
  }
  await mutateSettings(settingsPathFor(scope, cfgDir, projectPath), (obj) => {
    const perms = (obj.permissions && typeof obj.permissions === "object" && !Array.isArray(obj.permissions)
      ? obj.permissions
      : {}) as Record<string, unknown>;
    perms.allow = rules.allow.map(String);
    perms.deny = rules.deny.map(String);
    perms.ask = rules.ask.map(String);
    obj.permissions = perms;
  });
  return rules;
}

// ---------------- defaultMode 生效链 ----------------

export interface DefaultModeChain {
  /** 生效值；全链未配置为 null（CLI 自己的默认） */
  mode: string | null;
  /** 值来自哪一层；mode 为 null 时为 null */
  source: "local" | "project" | "user" | null;
}

/** defaultMode 生效链判定（与 chat.ts 的初始档位链同序）：项目 local > 项目 > 用户级。
 *  UI 徽标据此显示「生效值 + 来源」，避免只看 settings.json 被(local)误导。 */
export async function resolveDefaultMode(
  cfgDir: string,
  projectPath: string | null,
): Promise<DefaultModeChain> {
  const pick = async (p: string): Promise<string | null> => {
    const obj = await readSettings(p);
    const perms = obj.permissions;
    if (!perms || typeof perms !== "object" || Array.isArray(perms)) return null;
    const m = (perms as Record<string, unknown>).defaultMode;
    return typeof m === "string" && m !== "" ? m : null;
  };
  if (projectPath) {
    const local = await pick(settingsPathFor("project", cfgDir, projectPath, "local"));
    if (local) return { mode: local, source: "local" };
    const project = await pick(settingsPathFor("project", cfgDir, projectPath));
    if (project) return { mode: project, source: "project" };
  }
  const user = await pick(settingsPathFor("user", cfgDir, null));
  return user ? { mode: user, source: "user" } : { mode: null, source: null };
}

// ---------------- Hooks ----------------

/** hooks 表：事件名 → 条目数组；条目形如 { matcher?: string, hooks: [{type:"command", command, …}] }。
 *  事件集合与条目内字段由 CLI 定义，这里只做结构性校验、不枚举语义。 */
export type HooksMap = Record<string, unknown[]>;

/** 已知 hook 事件名（新增 Hook 表单的下拉数据源；写入校验只警告不拦截未知键——
 *  CLI 未来加事件时 UI 不必跟着发版） */
export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
] as const;

function validateHooksMap(hooks: HooksMap): void {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error("hooks 必须是对象（事件名 → 条目数组）");
  }
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) throw new Error(`hooks.${event} 必须是数组`);
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`hooks.${event} 的条目必须是对象`);
      }
      const hs = (entry as Record<string, unknown>).hooks;
      if (!Array.isArray(hs) || hs.length === 0) {
        throw new Error(`hooks.${event} 的条目缺少非空的 hooks 数组`);
      }
      for (const h of hs) {
        if (!h || typeof h !== "object" || Array.isArray(h)) {
          throw new Error(`hooks.${event} 的 hook 必须是对象`);
        }
        const cmd = (h as Record<string, unknown>).command;
        if (typeof cmd !== "string" || cmd.trim() === "") {
          throw new Error(`hooks.${event} 的 hook 缺少 command`);
        }
      }
    }
  }
}

export async function readHooks(
  scope: CcScope,
  cfgDir: string,
  projectPath: string | null,
): Promise<HooksMap> {
  const obj = await readSettings(settingsPathFor(scope, cfgDir, projectPath));
  const hooks = obj.hooks;
  return hooks && typeof hooks === "object" && !Array.isArray(hooks)
    ? (hooks as HooksMap)
    : {};
}

/** 整表写 hooks：读侧返回的是完整表（含 UI 未渲染的未知事件），UI 编辑后原样
 *  写回——未知事件键因此不丢。写前做结构校验，写坏 hooks 会让每次工具调用异常。 */
export async function writeHooks(
  scope: CcScope,
  cfgDir: string,
  projectPath: string | null,
  hooks: HooksMap,
): Promise<HooksMap> {
  if (scope === "project") validateProjectPath(projectPath);
  validateHooksMap(hooks);
  await mutateSettings(settingsPathFor(scope, cfgDir, projectPath), (obj) => {
    obj.hooks = hooks;
  });
  return hooks;
}

// ---------------- 插件启停（enabledPlugins） ----------------

export async function readEnabledPlugins(cfgDir: string): Promise<Record<string, boolean>> {
  const obj = await readSettings(claudeSettingsPathFrom(cfgDir));
  const ep = obj.enabledPlugins;
  if (!ep || typeof ep !== "object" || Array.isArray(ep)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(ep as Record<string, unknown>)) out[k] = v === true;
  return out;
}

/** 读用户级 settings.json 的 `extraKnownMarketplaces`（marketplace 的**声明**，
 *  与 `~/.claude/plugins/known_marketplaces.json` 的本地登记是两处、需并集展示）。
 *  返回 `{ 名字: 原条目 }`；缺键/坏结构一律当空表（marketplace add 会写这个键）。
 *  ⚠️ CLI 有别名键 `additionalMarketplaces`（语义相同；两键同写时 CLI 忽略别名并告警），
 *  老配置/项目级设置可能用别名，故一并读、canonical 优先。 */
export async function readExtraKnownMarketplaces(
  cfgDir: string,
): Promise<Record<string, unknown>> {
  const obj = await readSettings(claudeSettingsPathFrom(cfgDir));
  const asObj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return { ...asObj(obj.additionalMarketplaces), ...asObj(obj.extraKnownMarketplaces) };
}

/** 启停一个插件：只翻布尔位，表内其他键（含 false 的）原样保留 */
export async function setPluginEnabled(
  cfgDir: string,
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  if (!pluginId.trim()) throw new Error("插件 id 不能为空");
  await mutateSettings(claudeSettingsPathFrom(cfgDir), (obj) => {
    const ep = (obj.enabledPlugins && typeof obj.enabledPlugins === "object" && !Array.isArray(obj.enabledPlugins)
      ? obj.enabledPlugins
      : {}) as Record<string, unknown>;
    ep[pluginId] = enabled;
    obj.enabledPlugins = ep;
  });
}
