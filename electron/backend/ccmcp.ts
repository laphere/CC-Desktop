// MCP 服务器配置的三个 scope + .mcp.json 审批态的读写。
//
// user   = ~/.claude.json 顶层 mcpServers（全项目生效）
// local  = ~/.claude.json → projects.<项目路径键>.mcpServers（仅本机本项目）
// project= <项目>/.mcp.json（随仓库共享；是否启用由审批态决定）
// 审批态 = projects.<项目路径键>.{enabledMcpjsonServers,disabledMcpjsonServers}
//
// ~/.claude.json 是 CLI 高频整份回写的大状态文件（启动计数、tips、每项目统计都在
// 里面），所以这里每次写都是「现读最新 → 只改目标键 → 原子写回」，读路径带一次
// 短重试（见 ccjson.ts）。projects 键的定位规则见 ccjson.matchProjectKey。
import * as fs from "node:fs";
import * as path from "node:path";
import { writeJsonAtomic } from "./provider";
import { readJsonObjectFile, matchProjectKey, matchProjectKeys, canonicalProjectKey, validateProjectPath, deepEqual } from "./ccjson";
import { runClaude } from "./cccli";

export type McpScope = "user" | "project" | "local";

export interface McpServerView {
  name: string;
  scope: McpScope;
  /** 原样保留的服务器配置对象（type/command/args/env/url/headers…） */
  config: Record<string, unknown>;
  /** user/local 无审批概念（恒 true）；project scope 的 .mcp.json 服务器看审批态 */
  approved: boolean | null;
}

export interface McpListView {
  user: McpServerView[];
  project: McpServerView[];
  local: McpServerView[];
}

/**
 * ~/.claude.json 的定位：CLAUDE_CONFIG_DIR 用户大多把整个配置目录搬走，此时
 * .claude.json 在 <cfgDir> 内；该文件不存在时回退 home 下的默认位置。读和写
 * 必须用同一个解析结果（否则会写出一个 CLI 不认的新文件）。
 */
export function claudeJsonPath(cfgDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const inCfg = path.join(cfgDir, ".claude.json");
  try {
    if (fs.statSync(inCfg).isFile()) return inCfg;
  } catch {
    /* 落到默认位置 */
  }
  const home = env.USERPROFILE ?? env.HOME ?? "";
  return path.join(home, ".claude.json");
}

async function readClaudeJson(cfgDir: string, env?: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  return (await readJsonObjectFile(claudeJsonPath(cfgDir, env))) ?? {};
}

function writeClaudeJson(cfgDir: string, env: NodeJS.ProcessEnv, obj: Record<string, unknown>): void {
  writeJsonAtomic(claudeJsonPath(cfgDir, env), obj);
}

/** 定位（或新建）projects 下该项目的键：命中现存键用原键（保住其余状态字段），
 *  未命中才新建规范键。返回值同时给出是否命中——审批态读侧只读不新建。 */
export function projectKeyOf(
  claudeJson: Record<string, unknown>,
  projectPath: string,
  create: boolean,
): string | null {
  if (!projectPath) return null;
  const projects = (claudeJson.projects && typeof claudeJson.projects === "object" && !Array.isArray(claudeJson.projects)
    ? claudeJson.projects
    : {}) as Record<string, unknown>;
  const hit = matchProjectKey(projects, projectPath);
  if (hit) return hit;
  return create ? canonicalProjectKey(projectPath) : null;
}

function projectsRecord(claudeJson: Record<string, unknown>, key: string, create: boolean): Record<string, unknown> {
  let projects = claudeJson.projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) {
    if (!create) return {};
    projects = {};
    claudeJson.projects = projects;
  }
  const rec = (projects as Record<string, unknown>)[key];
  if (rec && typeof rec === "object" && !Array.isArray(rec)) {
    return rec as Record<string, unknown>;
  }
  if (!create) return {};
  const fresh: Record<string, unknown> = {};
  (projects as Record<string, unknown>)[key] = fresh;
  return fresh;
}

// ---------------- 读取 ----------------

function serversOf(obj: Record<string, unknown>, key: "mcpServers"): Record<string, unknown> {
  const v = obj[key];
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function toViews(
  scope: McpScope,
  servers: Record<string, unknown>,
  approvedFor: (name: string) => boolean | null,
): McpServerView[] {
  return Object.entries(servers).map(([name, config]) => ({
    name,
    scope,
    config: config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : { value: config },
    approved: approvedFor(name),
  }));
}

export async function listMcpServers(
  cfgDir: string,
  projectPath: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<McpListView> {
  const claudeJson = await readClaudeJson(cfgDir, env);

  // project scope 的审批态：enabled 名单为「批准」；disabled 名单为「拒绝」；
  // 两个名单都没有 = 待审批。enableAllProjectMcpServers 为 true 时全部视为批准。
  // 双键并存（正/反斜杠）时读侧合并展示（方案 §3 第 6 条）：local 服务器按名
  // 并集（先命中者优先），审批名单并集——写侧仍只写主命中键。
  const matchedKeys = projectPath ? matchProjectKeys(claudeJson.projects as Record<string, unknown> ?? {}, projectPath) : [];
  const recs = matchedKeys.map((k) => projectsRecord(claudeJson, k, false));
  const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const enabledList = new Set(recs.flatMap((r) => asList(r.enabledMcpjsonServers)));
  const disabledList = new Set(recs.flatMap((r) => asList(r.disabledMcpjsonServers)));
  const approveAll = recs.some((r) => r.enableAllProjectMcpServers === true);
  const approvalFor = (name: string): boolean | null =>
    approveAll || enabledList.has(name) ? true : disabledList.has(name) ? false : null;

  let localServers: Record<string, unknown> = {};
  for (const r of recs) {
    const s = r.mcpServers;
    if (s && typeof s === "object" && !Array.isArray(s)) {
      for (const [name, config] of Object.entries(s as Record<string, unknown>)) {
        if (!(name in localServers)) localServers[name] = config;
      }
    }
  }

  let projectServers: Record<string, unknown> = {};
  if (projectPath) {
    // .mcp.json 读失败（撕裂/被占用）要透出，不能静默渲染成空列表误导用户
    const mcpJson = await readJsonObjectFile(path.join(projectPath, ".mcp.json"));
    projectServers = serversOf(mcpJson ?? {}, "mcpServers");
  }

  return {
    user: toViews("user", serversOf(claudeJson, "mcpServers"), () => true),
    project: toViews("project", projectServers, approvalFor),
    local: toViews("local", localServers, () => true),
  };
}

// ---------------- 写入 ----------------

/** 服务器配置校验：stdio 必须有 command；http/sse 必须有 url。type 缺省按 stdio。 */
export function validateMcpConfig(config: unknown): void {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("MCP 服务器配置必须是 JSON 对象");
  }
  const c = config as Record<string, unknown>;
  const type = typeof c.type === "string" ? c.type : "stdio";
  if (type === "stdio") {
    if (typeof c.command !== "string" || c.command.trim() === "") {
      throw new Error("stdio 服务器需要 command 字段");
    }
  } else if (type === "http" || type === "sse") {
    if (typeof c.url !== "string" || c.url.trim() === "") {
      throw new Error(`${type} 服务器需要 url 字段`);
    }
  } else {
    throw new Error(`不支持的 MCP 服务器类型：${type}`);
  }
}

function validateName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 128 || /[\u0000-\u001f]/.test(n)) {
    throw new Error("MCP 服务器名不合法（非空、无控制字符、≤128 字符）");
  }
  return n;
}

async function mutateMcpServers(
  scope: McpScope,
  cfgDir: string,
  projectPath: string | null,
  mutate: (servers: Record<string, unknown>) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (scope === "project") {
    const dir = validateProjectPath(projectPath);
    const p = path.join(dir, ".mcp.json");
    const obj = (await readJsonObjectFile(p)) ?? {};
    const servers = serversOf(obj, "mcpServers");
    const before = JSON.stringify(servers);
    mutate(servers);
    if (JSON.stringify(servers) === before) return; // 无变更不落盘（.bak 不被轮换）
    obj.mcpServers = servers;
    writeJsonAtomic(p, obj);
    return;
  }
  await (async () => {
    const claudeJson = await readClaudeJson(cfgDir, env);
    if (scope === "user") {
      const servers = serversOf(claudeJson, "mcpServers");
      const before = JSON.stringify(servers);
      mutate(servers);
      if (JSON.stringify(servers) === before) return; // 无变更不落盘
      claudeJson.mcpServers = servers;
    } else {
      validateProjectPath(projectPath);
      const key = projectKeyOf(claudeJson, projectPath ?? "", true);
      if (!key) throw new Error("local scope 需要 projectPath");
      const rec = projectsRecord(claudeJson, key, true);
      const servers = (rec.mcpServers && typeof rec.mcpServers === "object" && !Array.isArray(rec.mcpServers)
        ? rec.mcpServers
        : {}) as Record<string, unknown>;
      const before = JSON.stringify(servers);
      mutate(servers);
      if (JSON.stringify(servers) === before) return; // 无变更不落盘
      rec.mcpServers = servers;
    }
    writeClaudeJson(cfgDir, env, claudeJson);
  })();
}

export async function saveMcpServer(
  scope: McpScope,
  cfgDir: string,
  projectPath: string | null,
  name: string,
  config: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const n = validateName(name);
  validateMcpConfig(config);
  await mutateMcpServers(scope, cfgDir, projectPath, (servers) => {
    servers[n] = config;
  }, env);
}

export async function deleteMcpServer(
  scope: McpScope,
  cfgDir: string,
  projectPath: string | null,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const n = validateName(name);
  await mutateMcpServers(scope, cfgDir, projectPath, (servers) => {
    if (!Object.prototype.hasOwnProperty.call(servers, n)) {
      throw new Error(`MCP 服务器 ${n} 在该 scope 下不存在`);
    }
    delete servers[n];
  }, env);
}

/** .mcp.json 服务器的审批：approved=true 进 enabled 名单（并从 disabled 摘除），
 *  false 进 disabled 名单。名单落在 projects.<项目路径键> 下。
 *  ⚠️ 项目记录已开 `enableAllProjectMcpServers`（CLI 侧「批准全部」）时，CLI 的
 *  连接判定短路在这个标志上——此时写「拒绝」名单是假动作（服务器照连），必须
 *  报错让用户先去 CLI 关掉全局批准，不能静默假成功。 */
export async function approveMcpServer(
  cfgDir: string,
  projectPath: string,
  name: string,
  approved: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const n = validateName(name);
  validateProjectPath(projectPath);
  const claudeJson = await readClaudeJson(cfgDir, env);
  const key = projectKeyOf(claudeJson, projectPath, true);
  if (!key) throw new Error("审批态需要 projectPath");
  const rec = projectsRecord(claudeJson, key, true);
  if (approved === false && rec.enableAllProjectMcpServers === true) {
    throw new Error("该项目已开启「批准全部 .mcp.json 服务器」，单条拒绝不会生效——请先在 Claude Code 里关闭该开关再拒绝");
  }
  const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const enabled = new Set(asList(rec.enabledMcpjsonServers));
  const disabled = new Set(asList(rec.disabledMcpjsonServers));
  enabled.delete(n);
  disabled.delete(n);
  (approved ? enabled : disabled).add(n);
  const nextEnabled = [...enabled];
  const nextDisabled = [...disabled];
  if (deepEqual(asList(rec.enabledMcpjsonServers), nextEnabled) && deepEqual(asList(rec.disabledMcpjsonServers), nextDisabled)) {
    return; // 无变更不落盘
  }
  rec.enabledMcpjsonServers = nextEnabled;
  rec.disabledMcpjsonServers = nextDisabled;
  writeClaudeJson(cfgDir, env, claudeJson);
}

// ---------------- 连接测试（只读 CLI：claude mcp get）----------------

export interface McpCheckResult {
  name: string | null;
  /** 归一后的状态：已连接 / 待审批 / 连接失败 / 其他原样文本 */
  status: string | null;
  scope: string | null;
  type: string | null;
  command: string | null;
  args: string | null;
  /** CLI 的 `Issue:` 行（连接失败原因，如 `CONNECTION_CLOSED: …`），无则 null */
  issue: string | null;
  /** 失败原因（超时/非零退出且无 stdout）；成功为 null */
  error: string | null;
  timedOut: boolean;
  /** CLI 原始输出，UI 折叠展示（解析不出时是唯一可见内容） */
  raw: string;
}

const EMPTY_CHECK: McpCheckResult = {
  name: null,
  status: null,
  scope: null,
  type: null,
  command: null,
  args: null,
  issue: null,
  error: null,
  timedOut: false,
  raw: "",
};

/** `✔ Connected` / `✘ …` / `⏸ Pending approval` → 中文可读状态，其余原样（去符号） */
function normalizeStatus(s: string): string {
  const t = s.replace(/[✔✘⏸]/g, "").trim();
  if (/connected/i.test(t)) return "已连接";
  if (/pending approval/i.test(t)) return "待审批";
  if (/fail|error|refused|timed? ?out|unreachable|not found/i.test(t)) return "连接失败";
  return t;
}

/**
 * 解析 `claude mcp get <name>` 的文本输出。**容错优先**：认不出的行跳过，解析不出
 * 还有 `raw` 可显示。实测形状（2.1.325）：
 * ```
 * codegraph:
 *   Scope: User config (available in all your projects)
 *   Status: ✔ Connected
 *   Type: stdio
 *   Command: codegraph
 *   Args: serve --mcp
 * ```
 */
export function parseMcpGet(text: string): McpCheckResult {
  const raw = text.trim();
  let name: string | null = null;
  let status: string | null = null;
  let scope: string | null = null;
  let type: string | null = null;
  let command: string | null = null;
  let args: string | null = null;
  let issue: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "") continue;
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      // 顶层行里**只有首个**是服务器名（形如 `codegraph:`）；其后还可能有
      // 「To remove this server, run: …」这类提示行，别当名字覆盖
      if (name === null) name = t.replace(/:$/, "");
      continue;
    }
    if (t.startsWith("Status:")) status = normalizeStatus(t.slice("Status:".length));
    else if (t.startsWith("Scope:")) scope = t.slice("Scope:".length).trim();
    else if (t.startsWith("Type:")) type = t.slice("Type:".length).trim();
    else if (t.startsWith("Command:")) command = t.slice("Command:".length).trim();
    else if (t.startsWith("Args:")) args = t.slice("Args:".length).trim();
    else if (t.startsWith("Issue:")) issue = t.slice("Issue:".length).trim();
  }

  return { ...EMPTY_CHECK, name, status, scope, type, command, args, issue, raw };
}

/** 连接测试（会真起服务器进程做健康检查）。
 *  ⚠️ cwd 传项目目录——项目 scope 的「待审批」判定依赖 CLI 的工作目录，
 *  不传会看不出 `.mcp.json` 里未批准的服务器。失败不抛，原因进 `error` + `raw`。 */
export async function checkMcpServer(
  name: string,
  projectPath: string | null,
): Promise<McpCheckResult> {
  const r = await runClaude(["mcp", "get", name], { cwd: projectPath ?? undefined });
  if (r.timedOut) {
    return {
      ...EMPTY_CHECK,
      name,
      status: "连接失败",
      error: "健康检查超时",
      timedOut: true,
      raw: [r.stdout, r.stderr].filter(Boolean).join("\n"),
    };
  }
  const out = r.stdout || r.stderr;
  if (r.code !== 0 && !r.stdout) {
    return { ...EMPTY_CHECK, name, status: "连接失败", error: `退出码 ${r.code ?? "未知"}`, raw: r.stderr };
  }
  const parsed = parseMcpGet(out);
  return { ...parsed, name: parsed.name ?? name };
}
