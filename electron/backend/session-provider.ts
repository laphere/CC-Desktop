// 会话级供应商状态（数据根下的独立文件 session-providers.json）。
//
// 为什么独立于 config.json：给 Config 加字段要同步 paths.ts 的 KNOWN_CONFIG_KEYS
// （数据根判定契约，见 ccstate.ts 的同款说明），为一串「会话 → 供应商」记录不值得。
// 独立文件 + 原子写 + .bak，与 ccstate.ts 同一套做法。
//
// 记录两类东西：
// - `sessions`：每个会话（按 sessionId）创建时用的供应商/模型，续聊时复用。
// - `last`：最近一次**新会话**用的选择，作为下次新会话的默认预选。
//
// 写用 config.ts 的 withConfigLock 串行化：多开几个对话 tab 会并发 chat_start，
// 各自读改写同一份文件会互相覆盖。
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, withConfigLock } from "./config";
import { writeFileAtomic } from "./provider";

/** 一次会话级选择：providerId 为 null = 不注入、跟随全局 settings */
export interface SessionProviderChoice {
  providerId: string | null;
  model: string | null;
}

interface SessionProviderState {
  last: SessionProviderChoice | null;
  sessions: Record<string, SessionProviderChoice>;
  /** 未知顶层键原样保留（与 config.ts 的 unknownFields 同一约定：本进程不认识 ≠ 可以丢） */
  extra: Record<string, unknown>;
}

function emptyState(): SessionProviderState {
  return { last: null, sessions: {}, extra: {} };
}

function statePath(root: string): string {
  return path.join(root, "session-providers.json");
}

function asChoice(v: unknown): SessionProviderChoice | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    providerId: typeof o.providerId === "string" ? o.providerId : null,
    model: typeof o.model === "string" ? o.model : null,
  };
}

function normalizeState(o: Record<string, unknown>): SessionProviderState {
  const st = emptyState();
  if (o.sessions && typeof o.sessions === "object" && !Array.isArray(o.sessions)) {
    for (const [id, v] of Object.entries(o.sessions)) {
      const c = asChoice(v);
      if (c) st.sessions[id] = c;
    }
  }
  st.last = asChoice(o.last);
  for (const [k, v] of Object.entries(o)) {
    if (k !== "last" && k !== "sessions") st.extra[k] = v;
  }
  return st;
}

function parseFile(p: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  return obj as Record<string, unknown>;
}

/**
 * 本功能写出的状态文件必然带 `sessions` 对象（encodeState 恒写 `last`+`sessions`）。
 * 只判「JSON 可解析」会把 `{}` / `{"sessions":null}` / `{"sessions":[]}` 当有效，
 * 于是既跳过 .bak 回退，又在下次写盘时把这份坏主文件 copyFileSync 进 .bak、
 * 把最后一份好备份冲掉——正是本函数要防的那个后果。
 *
 * 边界（接受）：只做**形状**校验，不管条目内容——`sessions` 里全是废条目
 * （如 `{"sessions":{"s1":null}}`）时 normalizeState 会静默丢光、也不回退。
 * 本项目的写是原子 rename，这种文件实际不可能出现，不再加语义比对。
 */
function isStateShape(o: Record<string, unknown>): boolean {
  return !!o.sessions && typeof o.sessions === "object" && !Array.isArray(o.sessions);
}

/**
 * 读状态：主文件缺失/损坏（含「可解析但不是本功能形态」）时回退 `.bak` 并恢复主文件
 * （对齐 config.ts 的 loadConfig）。⚠️ 不这么做的话，下一次写盘会先把**坏主文件**
 * copyFileSync 进 .bak，把最后一份好备份冲掉，所有历史记录永久丢失。
 */
export function readSessionProviderState(root: string): SessionProviderState {
  const p = statePath(root);
  const main = parseFile(p);
  if (main && isStateShape(main)) return normalizeState(main);
  const bak = parseFile(p + ".bak");
  if (bak && isStateShape(bak)) {
    try {
      fs.copyFileSync(p + ".bak", p);
    } catch {
      // 恢复失败不阻塞读取
    }
    return normalizeState(bak);
  }
  return emptyState();
}

function encodeState(st: SessionProviderState): string {
  return JSON.stringify({ ...st.extra, last: st.last, sessions: st.sessions }, null, 2);
}

/**
 * 纯函数：把供应商的 settingsConfig 转成可注入的 env。
 *
 * 两条实测口径（CLI 2.1.330，见会话级供应商方案）：
 * - flag 层 env 与用户 settings 的 env **逐键合并**，且 `ANTHROPIC_AUTH_TOKEN`
 *   优先于 `ANTHROPIC_API_KEY`。所以两个键必须都写：只写 API_KEY 时，全局
 *   settings 里残留的 AUTH_TOKEN 会赢，会话就会串用别家凭证。
 * - 供应商没声明任何凭证键时，两键写空串 = 清掉全局残留（实测空串会让 CLI
 *   找不到凭证而不回退到用户 env 的值）。
 *
 * 普通值统一 coerce 成字符串（预设里有数字形态，如 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1`，
 * 而 Settings.env 的值类型是 string）；**两个凭证键是例外**——非字符串一律按空串处理，
 * 不做 coerce（否则 `ANTHROPIC_AUTH_TOKEN: 123` 会被注入成 "123"）。
 */
export function buildProviderEnv(
  settingsConfig: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const env =
    settingsConfig.env && typeof settingsConfig.env === "object" && !Array.isArray(settingsConfig.env)
      ? (settingsConfig.env as Record<string, unknown>)
      : null;
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      if (v === null || v === undefined) continue;
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  // 凭证口径与 provider.ts 的 extractFingerprint 对齐：**键存在即 AUTH_TOKEN 权威**
  // （哪怕它是空串或 null），只有键不存在才回退 API_KEY——否则「AUTH_TOKEN:"" +
  // API_KEY:"k"」这类条目会注入 k、而指纹取空，两侧对同一个 live 得出不同结论。
  const authRaw = env?.ANTHROPIC_AUTH_TOKEN;
  const apiRaw = env?.ANTHROPIC_API_KEY;
  const hasAuthKey = !!env && Object.prototype.hasOwnProperty.call(env, "ANTHROPIC_AUTH_TOKEN");
  const cred = hasAuthKey
    ? typeof authRaw === "string"
      ? authRaw
      : ""
    : typeof apiRaw === "string"
      ? apiRaw
      : "";
  // 无凭证键时 cred 为空串，两键写空 = 清掉全局残留（否则别家凭证会被发到本供应商 base_url）。
  out.ANTHROPIC_AUTH_TOKEN = cred;
  out.ANTHROPIC_API_KEY = cred;
  return out;
}

/** 按 id 找供应商并构造 env；providerId 为空 / 供应商不存在 → null（跟随全局） */
export function resolveSessionProviderEnv(
  root: string,
  providerId: string | null,
): Record<string, string> | null {
  if (!providerId) return null;
  const p = loadConfig(root).providers.find((x) => x.id === providerId);
  if (!p) return null;
  return buildProviderEnv(p.settingsConfig);
}

/** 记录会话选择；`isNew` 时才更新 `last`（续聊不该改写「上次新会话的选择」）。
 *  内容无变化则不落盘（.bak 是退路，别被无意义的写轮换）。 */
export async function recordSessionProvider(
  root: string,
  sessionId: string,
  choice: SessionProviderChoice,
  isNew: boolean,
): Promise<void> {
  await withConfigLock(root, () => {
    const st = readSessionProviderState(root);
    const before = encodeState(st);
    st.sessions[sessionId] = { providerId: choice.providerId, model: choice.model };
    if (isNew) st.last = { providerId: choice.providerId, model: choice.model };
    const after = encodeState(st);
    if (after !== before) writeFileAtomic(statePath(root), after);
  });
}

/** 修剪：丢掉给定 sessionId 的记录（彻底删除 / 项目数据清理后调用） */
export async function pruneSessionProviders(
  root: string,
  sessionIds: string[],
): Promise<void> {
  if (sessionIds.length === 0) return;
  await withConfigLock(root, () => {
    const st = readSessionProviderState(root);
    const before = encodeState(st);
    for (const id of sessionIds) delete st.sessions[id];
    const after = encodeState(st);
    if (after !== before) writeFileAtomic(statePath(root), after);
  });
}
