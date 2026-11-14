// ccassets 单测：扫描 / frontmatter / 读写 / 删除进回收站 / 名字安全。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  assetNameSegments,
  deleteAsset,
  extractImports,
  listAssets,
  parseFrontmatter,
  readClaudeMd,
  writeAsset,
  writeClaudeMd,
} from "./ccassets";

let tmp: string; // 假装 ~/.claude
let proj: string;
let trash: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-test-ccasset-"));
  proj = path.join(tmp, "proj");
  fs.mkdirSync(proj);
  trash = path.join(tmp, "trash");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("frontmatter / imports", () => {
  it("解析 name/description；非 frontmatter 返回 {}", () => {
    const md = '---\nname: my-skill\ndescription: "做一件事"\n---\n\n# 正文';
    expect(parseFrontmatter(md)).toEqual({ name: "my-skill", description: "做一件事" });
    expect(parseFrontmatter("# 无 frontmatter")).toEqual({});
  });

  it("extractImports 只取像路径的 @token", () => {
    const md = "读 @docs/a.md 与 @~/lib/x.md，邮箱别抓 a@b.com，@notapath 也别抓";
    const im = extractImports(md);
    expect(im).toContain("docs/a.md");
    expect(im).toContain("~/lib/x.md");
    expect(im).not.toContain("b.com");
  });
});

describe("名字安全", () => {
  it("skill 只允许单段；.. 与多段拒绝；agent/command 允许嵌套", () => {
    expect(assetNameSegments("skill", "my-skill")).toEqual(["my-skill"]);
    expect(() => assetNameSegments("skill", "a/b")).toThrow();
    expect(() => assetNameSegments("skill", "..")).toThrow();
    expect(assetNameSegments("command", "frontend/ship")).toEqual(["frontend", "ship"]);
    expect(() => assetNameSegments("agent", "..\\evil")).toThrow();
  });
});

describe("技能读写删", () => {
  it("write 创建 <名>/SKILL.md → list 可见（带描述）→ delete 进回收站", async () => {
    await 0;
    writeAsset("skill", tmp, "user", null, "my-skill", "---\nname: my-skill\ndescription: 做事\n---\n正文");
    let list = await listAssets("skill", tmp, "user", null);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("my-skill");
    expect(list[0].description).toBe("做事");
    expect(list[0].isLink).toBe(false);

    const backup = deleteAsset("skill", tmp, "user", null, "my-skill", trash);
    expect(fs.existsSync(backup)).toBe(true);
    expect(fs.existsSync(path.join(tmp, "skills", "my-skill"))).toBe(false);
    expect(backup).toContain(path.join("cc-assets"));
    list = await listAssets("skill", tmp, "user", null);
    expect(list).toHaveLength(0);
  });

  it("半成品目录（无 SKILL.md）不进列表", async () => {
    fs.mkdirSync(path.join(tmp, "skills", "empty"), { recursive: true });
    expect(await listAssets("skill", tmp, "user", null)).toHaveLength(0);
  });

  it("符号链接/联接的技能目录也进列表，悬空链接不列", async () => {
    // 共享技能目录链进 skills/（如把 ~/.agents/skills 的技能链给 ~/.claude/skills）；
    // junction 在 Windows 无需管理员权限，macOS 上 type 参数被忽略、按普通链接创建
    const shared = path.join(tmp, "shared-skills", "linked-skill");
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(
      path.join(shared, "SKILL.md"),
      "---\nname: linked-skill\ndescription: 链接技能\n---\n正文",
    );
    fs.mkdirSync(path.join(tmp, "skills"), { recursive: true });
    fs.symlinkSync(shared, path.join(tmp, "skills", "linked-skill"), "junction");
    fs.symlinkSync(path.join(tmp, "shared-skills", "ghost"), path.join(tmp, "skills", "ghost"), "junction");

    const list = await listAssets("skill", tmp, "user", null);
    expect(list.map((v) => v.name)).toEqual(["linked-skill"]);
    expect(list[0].description).toBe("链接技能");
    expect(list[0].isLink).toBe(true);
    expect(fs.readFileSync(list[0].path, "utf8")).toContain("正文");
  });

  it("链接技能：编辑写透共享源；删除只移链接、共享源完好", async () => {
    const shared = path.join(tmp, "shared-skills", "linked-skill");
    fs.mkdirSync(shared, { recursive: true });
    const sharedMd = path.join(shared, "SKILL.md");
    fs.writeFileSync(sharedMd, "---\nname: linked-skill\n---\n正文");
    fs.mkdirSync(path.join(tmp, "skills"), { recursive: true });
    fs.symlinkSync(shared, path.join(tmp, "skills", "linked-skill"), "junction");

    // 编辑写透：改的是链接解析目标的文件
    writeAsset("skill", tmp, "user", null, "linked-skill", "---\nname: linked-skill\n---\n改后正文");
    expect(fs.readFileSync(sharedMd, "utf8")).toContain("改后正文");

    // 删除：链接从 skills/ 消失，共享源数据完好（备份形态随平台/卷位不同，只断言可访问）
    const backup = deleteAsset("skill", tmp, "user", null, "linked-skill", trash);
    expect(fs.existsSync(path.join(tmp, "skills", "linked-skill"))).toBe(false);
    expect(fs.existsSync(backup)).toBe(true);
    expect(fs.readFileSync(sharedMd, "utf8")).toContain("改后正文");
  });

  it("同秒删两个同名条目：两份备份都存在（回收站目录唯一化）", async () => {
    writeAsset("skill", tmp, "user", null, "dup", "---\nname: dup\n---\nA");
    writeAsset("skill", tmp, "project", proj, "dup", "---\nname: dup\n---\nB");
    const b1 = deleteAsset("skill", tmp, "user", null, "dup", trash);
    const b2 = deleteAsset("skill", tmp, "project", proj, "dup", trash);
    expect(b1).not.toBe(b2);
    // 备份的是技能目录本身，内容比对落在 SKILL.md 上
    expect(fs.readFileSync(path.join(b1, "SKILL.md"), "utf8")).toContain("A");
    expect(fs.readFileSync(path.join(b2, "SKILL.md"), "utf8")).toContain("B");
  });

  it("Windows 保留设备名 / 冒号（ADS）拒绝", () => {
    expect(() => assetNameSegments("skill", "CON")).toThrow(/保留/);
    expect(() => assetNameSegments("skill", "nul")).toThrow(/保留/);
    expect(() => assetNameSegments("command", "x:stream")).toThrow(/冒号/);
    expect(() => assetNameSegments("skill", "foo.")).toThrow(/结尾/);
  });
});

describe("子代理 / 命令", () => {
  it("命令支持嵌套名（frontend/ship.md），列表名带 /", async () => {
    writeAsset("command", tmp, "user", null, "frontend/ship", "发布流程 $ARGUMENTS");
    const list = await listAssets("command", tmp, "user", null);
    expect(list.map((v) => v.name)).toEqual(["frontend/ship"]);
    expect(fs.existsSync(list[0].path)).toBe(true);
  });

  it("项目级 agent 写到 <项目>/.claude/agents/", async () => {
    writeAsset("agent", tmp, "project", proj, "reviewer", "你是审查员");
    const list = await listAssets("agent", tmp, "project", proj);
    expect(list).toHaveLength(1);
    expect(list[0].path).toContain(path.join(".claude", "agents"));
  });
});

describe("CLAUDE.md", () => {
  it("missing 标记 + 保存后可读", async () => {
    const before = await readClaudeMd(tmp, "user", null);
    expect(before.missing).toBe(true);
    writeClaudeMd(tmp, "user", null, "# 全局规则");
    const after = await readClaudeMd(tmp, "user", null);
    expect(after.missing).toBe(false);
    expect(after.content).toBe("# 全局规则");
  });
});
