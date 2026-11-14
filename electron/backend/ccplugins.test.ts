// ccplugins 单测：installed_plugins.json 与 enabledPlugins 的并集视图（内置
// marketplace 条目没有安装记录，漏了就是真 bug——本机实测踩过的坑）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listPlugins, togglePlugin } from "./ccplugins";

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
