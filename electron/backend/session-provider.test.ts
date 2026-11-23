// 会话级供应商状态单测：buildProviderEnv 的凭证口径、状态文件读写 / last / 修剪。
// 夹具全用 os.tmpdir()，不碰真实数据根（照 provider.test.ts）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultConfig, saveConfig, type ProviderInfo } from "./config";
import {
  buildProviderEnv,
  pruneSessionProviders,
  readSessionProviderState,
  recordSessionProvider,
  resolveSessionProviderEnv,
} from "./session-provider";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-test-session-provider-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function provider(id: string, env: Record<string, unknown>): ProviderInfo {
  return { id, name: id, settingsConfig: { env } };
}

function saveProviders(providers: ProviderInfo[]): void {
  saveConfig(tmp, { ...defaultConfig(), providers });
}

describe("buildProviderEnv", () => {
  it("值统一 coerce 成字符串（预设里存在数字形态）", () => {
    const env = buildProviderEnv({
      env: { ANTHROPIC_BASE_URL: "https://x", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1 },
    });
    expect(env.ANTHROPIC_BASE_URL).toBe("https://x");
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
  });

  it("AUTH_TOKEN 优先，并同步写 API_KEY（逐键合并下避免全局残留赢）", () => {
    const env = buildProviderEnv({
      env: { ANTHROPIC_BASE_URL: "https://x", ANTHROPIC_AUTH_TOKEN: "tok" },
    });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("tok");
    expect(env.ANTHROPIC_API_KEY).toBe("tok");
  });

  it("只有 API_KEY 时也写双键", () => {
    const env = buildProviderEnv({ env: { ANTHROPIC_API_KEY: "key" } });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("key");
    expect(env.ANTHROPIC_API_KEY).toBe("key");
  });

  it("供应商无凭证键时两键写空串（清掉全局残留）", () => {
    const env = buildProviderEnv({ env: { ANTHROPIC_BASE_URL: "https://official" } });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("");
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("凭证键非字符串时按空串处理（不 coerce 成数字串）", () => {
    expect(buildProviderEnv({ env: { ANTHROPIC_AUTH_TOKEN: 123 } })).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_API_KEY: "",
    });
    expect(buildProviderEnv({ env: { ANTHROPIC_API_KEY: 456 } })).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_API_KEY: "",
    });
  });

  it("跳过 null / undefined 值", () => {
    const env = buildProviderEnv({ env: { A: null, B: undefined, C: "c" } });
    expect(env.A).toBeUndefined();
    expect(env.B).toBeUndefined();
    expect(env.C).toBe("c");
  });
});

describe("状态文件读写", () => {
  it("缺失 / 损坏一律按空处理", () => {
    expect(readSessionProviderState(tmp)).toEqual({ last: null, sessions: {}, extra: {} });
    fs.writeFileSync(path.join(tmp, "session-providers.json"), "{坏");
    expect(readSessionProviderState(tmp)).toEqual({ last: null, sessions: {}, extra: {} });
  });

  it("主文件损坏时回退 .bak 并恢复主文件", () => {
    const good = JSON.stringify(
      { last: { providerId: "p1", model: null }, sessions: { s1: { providerId: "p1", model: null } } },
      null,
      2,
    );
    // 主文件写坏、备份还是好的（首次写入不产生 .bak，故直接落两个文件）
    fs.writeFileSync(path.join(tmp, "session-providers.json"), "{坏");
    fs.writeFileSync(path.join(tmp, "session-providers.json.bak"), good);
    const st = readSessionProviderState(tmp);
    expect(st.sessions.s1).toEqual({ providerId: "p1", model: null });
    expect(st.last).toEqual({ providerId: "p1", model: null });
    // 恢复：主文件内容与 .bak 一致（否则下次写会把坏内容灌进 .bak）
    expect(fs.readFileSync(path.join(tmp, "session-providers.json"), "utf8")).toBe(good);
  });

  it("主文件可解析但不是本功能形态（sessions 非对象）也回退 .bak", () => {
    const good = JSON.stringify(
      { last: null, sessions: { s1: { providerId: "p1", model: null } } },
      null,
      2,
    );
    // 合法 JSON，但本进程永远不会写出这种形态（encodeState 恒写 sessions 对象）
    fs.writeFileSync(path.join(tmp, "session-providers.json"), JSON.stringify({ sessions: null }));
    fs.writeFileSync(path.join(tmp, "session-providers.json.bak"), good);
    const st = readSessionProviderState(tmp);
    expect(st.sessions.s1).toEqual({ providerId: "p1", model: null });
  });

  it("未知顶层键原样保留（同 config.ts 的 unknownFields 约定）", async () => {
    fs.writeFileSync(
      path.join(tmp, "session-providers.json"),
      JSON.stringify({ last: null, sessions: {}, futureKey: { a: 1 } }, null, 2),
    );
    await recordSessionProvider(tmp, "s1", { providerId: "p1", model: null }, false);
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, "session-providers.json"), "utf8"));
    expect(raw.futureKey).toEqual({ a: 1 });
    expect(raw.sessions.s1).toEqual({ providerId: "p1", model: null });
  });

  it("记录会话选择；isNew 才更新 last", async () => {
    await recordSessionProvider(tmp, "s1", { providerId: "p1", model: "m1" }, true);
    let st = readSessionProviderState(tmp);
    expect(st.sessions.s1).toEqual({ providerId: "p1", model: "m1" });
    expect(st.last).toEqual({ providerId: "p1", model: "m1" });

    // 续聊（isNew=false）改的是会话记录，不动 last
    await recordSessionProvider(tmp, "s1", { providerId: "p2", model: null }, false);
    st = readSessionProviderState(tmp);
    expect(st.sessions.s1).toEqual({ providerId: "p2", model: null });
    expect(st.last).toEqual({ providerId: "p1", model: "m1" });
  });

  it("last 可以为 null（用户显式选「跟随配置」）", async () => {
    await recordSessionProvider(tmp, "s1", { providerId: null, model: null }, true);
    expect(readSessionProviderState(tmp).last).toEqual({ providerId: null, model: null });
  });

  it("修剪只丢给定 sessionId", async () => {
    await recordSessionProvider(tmp, "s1", { providerId: "p1", model: null }, false);
    await recordSessionProvider(tmp, "s2", { providerId: "p2", model: null }, false);
    await pruneSessionProviders(tmp, ["s1"]);
    const st = readSessionProviderState(tmp);
    expect(st.sessions.s1).toBeUndefined();
    expect(st.sessions.s2).toEqual({ providerId: "p2", model: null });
  });
});

describe("resolveSessionProviderEnv", () => {
  it("按 id 找供应商并构造 env", () => {
    saveProviders([provider("p1", { ANTHROPIC_BASE_URL: "https://a", ANTHROPIC_AUTH_TOKEN: "t" })]);
    expect(resolveSessionProviderEnv(tmp, "p1")).toEqual({
      ANTHROPIC_BASE_URL: "https://a",
      ANTHROPIC_AUTH_TOKEN: "t",
      ANTHROPIC_API_KEY: "t",
    });
  });

  it("providerId 为空 / 供应商不存在 → null（跟随全局）", () => {
    saveProviders([provider("p1", { ANTHROPIC_AUTH_TOKEN: "t" })]);
    expect(resolveSessionProviderEnv(tmp, null)).toBeNull();
    expect(resolveSessionProviderEnv(tmp, "nope")).toBeNull();
  });
});
