// ccplugins 单测：installed_plugins.json 与 enabledPlugins 的并集视图（内置
// marketplace 条目没有安装记录，漏了就是真 bug——本机实测踩过的坑）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  listPlugins,
  mergeMarketplaces,
  parseCliJsonLine,
  parsePluginDetails,
  togglePlugin,
} from "./ccplugins";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-test-ccplug-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeInstalled(obj: unknown): void {
  fs.mkdirSync(path.join(tmp, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "plugins", "installed_plugins.json"), JSON.stringify(obj), "utf8");
}

function writeMarketplaces(obj: unknown): void {
  fs.mkdirSync(path.join(tmp, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "plugins", "known_marketplaces.json"), JSON.stringify(obj), "utf8");
}

function writeUserSettings(obj: unknown): void {
  fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify(obj), "utf8");
}

describe("并集视图", () => {
  it("installed 有而 enabledPlugins 没有的 → enabled=false；反之（内置）→ installed=false", async () => {
    writeInstalled({
      version: 2,
      plugins: {
        "code-review@m": [{ scope: "user", installPath: path.join(tmp, "p1"), version: "1.0.0" }],
      },
    });
    writeUserSettings({
      enabledPlugins: { "code-review@m": true, "document-skills@built-in": true },
    });
    const view = await listPlugins(tmp);
    const ids = view.plugins.map((p) => p.id);
    expect(ids).toContain("code-review@m");
    expect(ids).toContain("document-skills@built-in");

    const cr = view.plugins.find((p) => p.id === "code-review@m")!;
    expect(cr.installed).toBe(true);
    expect(cr.enabled).toBe(true);
    expect(cr.version).toBe("1.0.0");
    expect(cr.installPathExists).toBe(false); // 路径没真的建 → 标缺失

    const bi = view.plugins.find((p) => p.id === "document-skills@built-in")!;
    expect(bi.installed).toBe(false);
    expect(bi.enabled).toBe(true);
    expect(bi.name).toBe("document-skills");
    expect(bi.marketplace).toBe("built-in");
  });

  it("name/marketplace 按 @ 拆分（marketplace 本身可含 @ 之外的部分只拆第一个）", async () => {
    writeInstalled({ version: 2, plugins: {} });
    writeUserSettings({ enabledPlugins: { "x@a@b": true } });
    const view = await listPlugins(tmp);
    expect(view.plugins[0].name).toBe("x");
    expect(view.plugins[0].marketplace).toBe("a@b");
  });

  it("marketplace 表读取", async () => {
    writeMarketplaces({ "official": { source: { source: "github", repo: "anthropics/x" } } });
    const view = await listPlugins(tmp);
    expect(view.marketplaces[0]).toMatchObject({ name: "official", sourceType: "github", repo: "anthropics/x" });
  });
});

describe("启停", () => {
  it("toggle 写 enabledPlugins 布尔位，不动其他键", async () => {
    writeUserSettings({ env: { A: "b" }, enabledPlugins: { "a@b": true } });
    await togglePlugin(tmp, "a@b", false);
    const view = await listPlugins(tmp);
    expect(view.plugins[0].enabled).toBe(false);
    // env 键仍在
    const settings = JSON.parse(fs.readFileSync(path.join(tmp, "settings.json"), "utf8"));
    expect(settings.env).toEqual({ A: "b" });
  });
});

// fixture 取自本机 CLI 2.1.325 的 `claude plugin details <id>` 实测输出。
// ⚠️ 非零组件会在 (N) 后列出组件名（`Skills (1)  hud`），别把正则尾部锚死。
const DETAILS_SAMPLE = `claude-hud 0.7.0
  Description: Real-time statusline showing context usage, active tools, running agents, and todo progress.
  Source: claude-hud@claude-hud

Component inventory
  Skills (1)  hud
  Agents (0)
  Hooks (0)
  MCP servers (0)
  LSP servers (0)

Projected token cost
  Always-on:   ~0 tok   added to every session`;

describe("parsePluginDetails", () => {
  it("解析名字/版本/描述/来源/组件清单/token 成本", () => {
    const d = parsePluginDetails(DETAILS_SAMPLE);
    expect(d.error).toBeNull();
    expect(d.name).toBe("claude-hud");
    expect(d.version).toBe("0.7.0");
    expect(d.description).toContain("Real-time statusline");
    expect(d.source).toBe("claude-hud@claude-hud");
    expect(d.components).toEqual([
      { label: "Skills", count: 1 },
      { label: "Agents", count: 0 },
      { label: "Hooks", count: 0 },
      { label: "MCP servers", count: 0 },
      { label: "LSP servers", count: 0 },
    ]);
    expect(d.tokenAlwaysOn).toContain("~0 tok");
    expect(d.raw).toContain("Projected token cost");
  });

  it("没有 token 成本段：tokenAlwaysOn 为 null，不报错", () => {
    const d = parsePluginDetails("foo 1.2.3\n  Description: x\n  Source: foo@bar\n\nComponent inventory\n  Skills (2)");
    expect(d.name).toBe("foo");
    expect(d.components).toEqual([{ label: "Skills", count: 2 }]);
    expect(d.tokenAlwaysOn).toBeNull();
    expect(d.tokenLines).toEqual([]);
  });

  it("空文本：字段全空，raw 为空串（UI 据此显示空态）", () => {
    const d = parsePluginDetails("   \n\n ");
    expect(d.name).toBeNull();
    expect(d.components).toEqual([]);
    expect(d.raw).toBe("");
  });

  it("非预期格式：不抛错，raw 原样保留（容错优先）", () => {
    const weird = " whatever\n ligne inattendue";
    const d = parsePluginDetails(weird);
    expect(d.raw).toContain("inattendue");
    expect(d.components).toEqual([]);
  });
});

describe("parseCliJsonLine", () => {
  it("从后往前找 JSON：消息在前、JSON 在后", () => {
    const r = parseCliJsonLine(
      "正在安装…\n完成\n{\"command\":\"install\",\"outcome\":\"ok\",\"plugin\":\"x\",\"message\":\"已安装\"}",
    );
    expect(r.ok).toBe(true);
    expect(r.message).toBe("已安装");
    expect(r.failureCode).toBeNull();
    expect(r.raw).toContain("正在安装");
  });

  it("多行 JSON 时取最后一条（贴合 CLI「结果在最后一行」的契约）", () => {
    const r = parseCliJsonLine(
      "{\"event\":\"progress\",\"message\":\"克隆中\"}\n{\"command\":\"install\",\"outcome\":\"ok\",\"message\":\"已安装\"}",
    );
    expect(r.ok).toBe(true);
    expect(r.message).toBe("已安装");
  });

  it("失败：带 failureCode", () => {
    const r = parseCliJsonLine('{"command":"uninstall","outcome":"failed","message":"未安装","failureCode":"not_installed"}');
    expect(r.ok).toBe(false);
    expect(r.failureCode).toBe("not_installed");
  });

  it("JSON 在前、人类消息在后（实测 uninstall 失败的顺序）", () => {
    const r = parseCliJsonLine(
      '{"command":"uninstall","outcome":"failed","plugin":"x@n","scope":"user","message":"not found","failureCode":"not_installed"}\n✘ Failed to uninstall plugin "x@n": not found',
    );
    expect(r.ok).toBe(false);
    expect(r.failureCode).toBe("not_installed");
    expect(r.message).toBe("not found");
  });

  it("只有人类消息、没有 JSON：兜底成失败", () => {
    const r = parseCliJsonLine("✘ Failed to uninstall: whatever");
    expect(r.ok).toBe(false);
    expect(r.failureCode).toBeNull();
    expect(r.message).toContain("whatever");
  });

  it("非 JSON / 无输出：按失败返回原文，不抛", () => {
    const r = parseCliJsonLine("一些奇怪输出");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("奇怪输出");
    expect(parseCliJsonLine("   ").ok).toBe(false);
  });
});

describe("mergeMarketplaces", () => {
  const known = {
    a: { source: { source: "github", repo: "o/a" }, installLocation: "/x/a", lastUpdated: "t1" },
    b: { source: { source: "github", repo: "o/b" }, installLocation: "/x/b" },
  };
  const extra = {
    b: { source: { source: "github", repo: "o/b-other" } },
    c: { source: { source: "git", repo: "https://host/c" } },
  };

  it("两处并集，known 优先；settings 独有条目也出现", () => {
    const out = mergeMarketplaces(known, extra);
    expect(out.map((m) => m.name)).toEqual(["a", "b", "c"]);
    const b = out.find((m) => m.name === "b")!;
    expect(b.installLocation).toBe("/x/b"); // known 的字段保留
    expect(b.repo).toBe("o/b"); // known 优先，不被 extra 覆盖
    expect(out.find((m) => m.name === "c")!.sourceType).toBe("git");
  });

  it("extra 补 known 缺的 source；坏结构当空", () => {
    const out = mergeMarketplaces(
      { x: { installLocation: "/x" } },
      { x: { source: { source: "github", repo: "o/x" } }, y: null },
    );
    const x = out.find((m) => m.name === "x")!;
    expect(x.sourceType).toBe("github");
    expect(x.installLocation).toBe("/x");
    expect(out.find((m) => m.name === "y")!.sourceType).toBeNull();
  });

  it("known 缺失/为空时只用 extra", () => {
    expect(mergeMarketplaces(null, extra).map((m) => m.name)).toEqual(["b", "c"]);
    expect(mergeMarketplaces(null, {}).length).toBe(0);
  });
});
