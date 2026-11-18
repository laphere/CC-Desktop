// ccsettings 单测：settings.json 读改写的「未知键保留」是本模块的生命线
// （settings.json 同时被供应商切换 / CLI / 用户手改），每个写函数都要守住它。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readEnabledPlugins,
  readExtraKnownMarketplaces,
  readHooks,
  readPermissionRules,
  resolveDefaultMode,
  setPluginEnabled,
  writeHooks,
  writePermissionRules,
} from "./ccsettings";

let tmp: string; // 假装 ~/.claude
let proj: string; // 假装项目目录

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-test-ccset-"));
  proj = path.join(tmp, "proj");
  fs.mkdirSync(proj);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeUserSettings(obj: unknown): void {
  fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify(obj, null, 2), "utf8");
}

function readUserSettings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(tmp, "settings.json"), "utf8"));
}

describe("权限规则", () => {
  it("写 allow/deny/ask 只动三组，defaultMode 与其余键逐字保留", async () => {
    writeUserSettings({
      env: { ANTHROPIC_BASE_URL: "https://x", ANTHROPIC_API_KEY: "k" },
      permissions: { allow: ["Bash(tree:*)"], deny: [], defaultMode: "bypassPermissions", extraFutureKey: 1 },
      enabledPlugins: { "a@b": true },
    });
    await writePermissionRules("user", tmp, null, { allow: ["Bash(git:*)"], deny: ["Bash(rm:*)"], ask: [] });
    const after = readUserSettings();
    expect(after.env).toEqual({ ANTHROPIC_BASE_URL: "https://x", ANTHROPIC_API_KEY: "k" });
    expect((after.permissions as Record<string, unknown>).defaultMode).toBe("bypassPermissions");
    expect((after.permissions as Record<string, unknown>).extraFutureKey).toBe(1);
    expect((after.permissions as Record<string, unknown>).allow).toEqual(["Bash(git:*)"]);
    expect((after.permissions as Record<string, unknown>).deny).toEqual(["Bash(rm:*)"]);
    expect((after.enabledPlugins as Record<string, unknown>)["a@b"]).toBe(true);
  });

  it("读：缺文件 = 空规则；BOM 容忍", async () => {
    expect(await readPermissionRules("user", tmp, null)).toEqual({ allow: [], deny: [], ask: [], additionalDirectories: [] });
    fs.writeFileSync(path.join(tmp, "settings.json"), "\uFEFF{\"permissions\":{\"allow\":[\"Bash(ls)\"]}}", "utf8");
    expect((await readPermissionRules("user", tmp, null)).allow).toEqual(["Bash(ls)"]);
  });

  it("项目级写到 <项目>/.claude/settings.json，不动用户级", async () => {
    writeUserSettings({ permissions: { allow: ["user-rule"] } });
    await writePermissionRules("project", tmp, proj, { allow: ["proj-rule"], deny: [], ask: [] });
    expect((await readPermissionRules("user", tmp, null)).allow).toEqual(["user-rule"]);
    expect((await readPermissionRules("project", tmp, proj)).allow).toEqual(["proj-rule"]);
    const pjson = JSON.parse(fs.readFileSync(path.join(proj, ".claude", "settings.json"), "utf8"));
    expect(pjson.permissions.allow).toEqual(["proj-rule"]);
  });

  it("非法输入（数组非字符串）拒绝且不落盘", async () => {
    writeUserSettings({ permissions: { allow: ["keep"] } });
    await expect(
      writePermissionRules("user", tmp, null, { allow: [1, 2] as never, deny: [], ask: [] }),
    ).rejects.toThrow();
    expect((await readPermissionRules("user", tmp, null)).allow).toEqual(["keep"]);
  });

  it("无变更不落盘：写相同规则不重写文件（哨兵：紧凑格式不被重排成 2 空格缩进）", async () => {
    // 深比较守卫的失败模式是静默的（浅拷贝 bug 就靠它抓的）：用「非规范格式」
    // 当哨兵——若发生了落盘，内容会被 JSON.stringify(,2) 重排，紧凑原文即失。
    // 前置三组键都已存在且与写入值逐字相同，才是真正的「无变更」。
    const compact = '{"permissions":{"allow":["Bash(ls)"],"deny":[],"ask":[]},"sentinel":true}';
    fs.writeFileSync(path.join(tmp, "settings.json"), compact, "utf8");
    await writePermissionRules("user", tmp, null, { allow: ["Bash(ls)"], deny: [], ask: [] });
    expect(fs.readFileSync(path.join(tmp, "settings.json"), "utf8")).toBe(compact);
  });

  it("stale 项目（目录已删）：读优雅降级为空规则，写拒绝", async () => {
    const ghost = path.join(tmp, "deleted-project"); // 不创建
    expect(await readPermissionRules("project", tmp, ghost)).toEqual({ allow: [], deny: [], ask: [], additionalDirectories: [] });
    expect(await readHooks("project", tmp, ghost)).toEqual({});
    expect((await resolveDefaultMode(tmp, ghost)).mode).toBeNull();
    await expect(
      writePermissionRules("project", tmp, ghost, { allow: ["x"], deny: [], ask: [] }),
    ).rejects.toThrow(/不存在/);
  });
});

describe("defaultMode 生效链", () => {
  it("local > project > user，全空 = null", async () => {
    expect(await resolveDefaultMode(tmp, proj)).toEqual({ mode: null, source: null });

    fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify({ permissions: { defaultMode: "acceptEdits" } }));
    expect(await resolveDefaultMode(tmp, proj)).toEqual({ mode: "acceptEdits", source: "user" });

    fs.mkdirSync(path.join(proj, ".claude"));
    fs.writeFileSync(path.join(proj, ".claude", "settings.json"), JSON.stringify({ permissions: { defaultMode: "plan" } }));
    expect(await resolveDefaultMode(tmp, proj)).toEqual({ mode: "plan", source: "project" });

    fs.writeFileSync(path.join(proj, ".claude", "settings.local.json"), JSON.stringify({ permissions: { defaultMode: "manual" } }));
    expect(await resolveDefaultMode(tmp, proj)).toEqual({ mode: "manual", source: "local" });
  });
});

describe("hooks", () => {
  it("整表写回保留未知事件键；结构校验拦空 command", async () => {
    writeUserSettings({
      hooks: { "FutureEvent": [{ hooks: [{ type: "command", command: "echo hi" }] }] },
    });
    await writeHooks("user", tmp, null, {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node x.js" }] }],
      FutureEvent: [{ hooks: [{ type: "command", command: "echo hi" }] }],
    });
    const hooks = await readHooks("user", tmp, null);
    expect(Object.keys(hooks)).toContain("FutureEvent");
    expect(hooks.PreToolUse).toHaveLength(1);

    await expect(
      writeHooks("user", tmp, null, { PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "  " }] }] }),
    ).rejects.toThrow(/command/);
    // 失败后磁盘内容不变
    expect((await readHooks("user", tmp, null)).PreToolUse).toHaveLength(1);
  });
});

describe("插件启停", () => {
  it("只翻布尔位，表内其他条目与其他键保留；false 条目也保留", async () => {
    writeUserSettings({
      env: { A: "b" },
      enabledPlugins: { "keep@me": false, "a@b": true },
    });
    await setPluginEnabled(tmp, "a@b", false);
    await setPluginEnabled(tmp, "new@one", true);
    const ep = await readEnabledPlugins(tmp);
    expect(ep).toEqual({ "keep@me": false, "a@b": false, "new@one": true });
    expect(readUserSettings().env).toEqual({ A: "b" });
  });
});

describe("extraKnownMarketplaces", () => {
  it("读 canonical 键；缺键/坏结构返回空表", async () => {
    writeUserSettings({ extraKnownMarketplaces: { m: { source: { source: "github", repo: "o/m" } } } });
    expect(Object.keys(await readExtraKnownMarketplaces(tmp))).toEqual(["m"]);
    writeUserSettings({});
    expect(await readExtraKnownMarketplaces(tmp)).toEqual({});
    writeUserSettings({ extraKnownMarketplaces: "坏" });
    expect(await readExtraKnownMarketplaces(tmp)).toEqual({});
  });

  it("别名 additionalMarketplaces 一并读，canonical 优先（与 CLI 的别名解析一致）", async () => {
    writeUserSettings({
      additionalMarketplaces: {
        aliasOnly: { source: { repo: "a/b" } },
        both: { source: { repo: "old" } },
      },
      extraKnownMarketplaces: { both: { source: { repo: "new" } } },
    });
    const got = await readExtraKnownMarketplaces(tmp);
    expect(Object.keys(got).sort()).toEqual(["aliasOnly", "both"]);
    expect((got["both"] as Record<string, unknown>).source).toEqual({ repo: "new" });
  });
});
