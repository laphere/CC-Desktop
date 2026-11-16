// ccmcp 单测：三 scope 读写 + ~/.claude.json 的并发安全面
// （projects 键归一匹配 / 其余状态字段与未知键不丢 / 半份 JSON 报错不静默重置）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  approveMcpServer,
  claudeJsonPath,
  deleteMcpServer,
  listMcpServers,
  parseMcpGet,
  saveMcpServer,
  validateMcpConfig,
} from "./ccmcp";

let tmp: string; // 假装 ~/.claude（.claude.json 落它的上一级 home）
let home: string;
let proj: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-test-cchome-"));
  proj = path.join(home, "proj");
  fs.mkdirSync(proj);
  tmp = path.join(home, ".claude");
  fs.mkdirSync(tmp);
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function claudeJsonPathInHome(): string {
  return path.join(home, ".claude.json");
}

function writeClaudeJson(obj: unknown): void {
  fs.writeFileSync(claudeJsonPathInHome(), JSON.stringify(obj, null, 2), "utf8");
}

function readClaudeJson(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(claudeJsonPathInHome(), "utf8"));
}

describe("claudeJsonPath 定位", () => {
  it("cfgDir 内存在则优先；否则回退 home/.claude.json", () => {
    expect(claudeJsonPath(tmp, { USERPROFILE: home })).toBe(claudeJsonPathInHome());
    fs.writeFileSync(path.join(tmp, ".claude.json"), "{}");
    expect(claudeJsonPath(tmp, { USERPROFILE: home })).toBe(path.join(tmp, ".claude.json"));
  });
});

describe("user scope", () => {
  it("保存/删除只动 mcpServers，顶层未知键保留", async () => {
    writeClaudeJson({ numStartups: 42, userID: "u1", mcpServers: { old: { type: "stdio", command: "x" } } });
    await saveMcpServer("user", tmp, null, "codegraph", { type: "stdio", command: "codegraph", args: ["serve", "--mcp"] }, { USERPROFILE: home });
    let j = readClaudeJson();
    expect(j.numStartups).toBe(42);
    expect(j.userID).toBe("u1");
    expect(Object.keys(j.mcpServers as Record<string, unknown>)).toEqual(["old", "codegraph"]);

    await deleteMcpServer("user", tmp, null, "old", { USERPROFILE: home });
    j = readClaudeJson();
    expect(Object.keys(j.mcpServers as Record<string, unknown>)).toEqual(["codegraph"]);
  });

  it("删除不存在的名字报错", async () => {
    await expect(deleteMcpServer("user", tmp, null, "ghost", { USERPROFILE: home })).rejects.toThrow(/不存在/);
  });
});

describe("local scope（projects 键归一匹配）", () => {
  it("正斜杠键 + 反斜杠 projectPath：命中原键写回，未知状态字段保留", async () => {
    writeClaudeJson({
      projects: {
        "D:/MyWorkspaces/myProject/claude-fast": {
          allowedTools: ["a"],
          lastSessionId: "s1",
          mcpServers: { mine: { type: "stdio", command: "c1" } },
        },
      },
    });
    const winPath = "D:\\MyWorkspaces\\myProject\\claude-fast";
    await saveMcpServer("local", tmp, winPath, "added", { type: "stdio", command: "c2" }, { USERPROFILE: home });
    const projectsMap = readClaudeJson().projects as Record<string, Record<string, unknown>>;
    const rec = projectsMap["D:/MyWorkspaces/myProject/claude-fast"];
    expect(rec.lastSessionId).toBe("s1"); // CLI 状态字段不丢
    expect(rec.allowedTools as string[]).toEqual(["a"]);
    const servers = rec.mcpServers as Record<string, unknown>;
    expect(Object.keys(servers).sort()).toEqual(["added", "mine"]);
  });

  it("双键并存：写到匹配到的现存键，不新建第二份", async () => {
    // projectPath 必须真实存在（validateProjectPath 防线），键用临时目录的实路径
    const realDir = fs.mkdtempSync(path.join(home, "dualkey-"));
    const fwd = realDir.replace(/\\/g, "/");
    writeClaudeJson({
      projects: {
        [fwd]: { mcpServers: { a: { type: "stdio", command: "c" } } },
        [realDir]: { mcpServers: { b: { type: "stdio", command: "c" } } },
      },
    });
    await saveMcpServer("local", tmp, realDir, "c", { type: "stdio", command: "c3" }, { USERPROFILE: home });
    const projects = readClaudeJson().projects as Record<string, Record<string, unknown>>;
    expect(Object.keys(projects)).toHaveLength(2); // 不新增键
    // 匹配按归一序首个命中：写入其中一份，两份各自不互相污染
    const sum = Object.values(projects).flatMap((p) => Object.keys(p.mcpServers as Record<string, unknown>));
    expect(sum.filter((n) => n === "c")).toHaveLength(1);
  });

  it("无现存键：新建规范键（正斜杠 resolve 形式）", async () => {
    await saveMcpServer("local", tmp, path.join(proj), "n1", { type: "stdio", command: "c" }, { USERPROFILE: home });
    const projects = readClaudeJson().projects as Record<string, unknown>;
    const key = Object.keys(projects)[0];
    expect(key).toBe(proj.replace(/\\/g, "/"));
  });

  it("双键并存读合并：local 服务器按名并集、审批名单并集（写仍只进主键）", async () => {
    const realDir = fs.mkdtempSync(path.join(home, "merge-"));
    const fwd = realDir.replace(/\\/g, "/");
    writeClaudeJson({
      projects: {
        [fwd]: {
          mcpServers: { mine: { type: "stdio", command: "c1" } },
          enabledMcpjsonServers: ["shared-a"],
        },
        [realDir]: {
          mcpServers: { other: { type: "stdio", command: "c2" } },
          disabledMcpjsonServers: ["shared-b"],
        },
      },
    });
    const view = await listMcpServers(tmp, realDir, { USERPROFILE: home });
    expect(view.local.map((s) => s.name).sort()).toEqual(["mine", "other"]);
    // 审批并集：shared-a 任一键批准 → true；shared-b 任一键拒绝 → false
    await saveMcpServer("project", tmp, realDir, "shared-a", { type: "http", url: "https://a" }, { USERPROFILE: home });
    await saveMcpServer("project", tmp, realDir, "shared-b", { type: "http", url: "https://b" }, { USERPROFILE: home });
    const view2 = await listMcpServers(tmp, realDir, { USERPROFILE: home });
    expect(view2.project.find((s) => s.name === "shared-a")?.approved).toBe(true);
    expect(view2.project.find((s) => s.name === "shared-b")?.approved).toBe(false);
  });
});

describe("project scope 与审批态", () => {
  it(".mcp.json 往返；审批名单写进 projects 键", async () => {
    await saveMcpServer("project", tmp, proj, "sentry", { type: "http", url: "https://mcp.sentry.dev/mcp" });
    const mcpJson = JSON.parse(fs.readFileSync(path.join(proj, ".mcp.json"), "utf8"));
    expect(mcpJson.mcpServers.sentry.url).toBe("https://mcp.sentry.dev/mcp");

    writeClaudeJson({ projects: {} });
    await approveMcpServer(tmp, proj, "sentry", true, { USERPROFILE: home });
    let rec = (readClaudeJson().projects as Record<string, Record<string, unknown>>)[proj.replace(/\\/g, "/")];
    expect(rec.enabledMcpjsonServers as string[]).toEqual(["sentry"]);

    await approveMcpServer(tmp, proj, "sentry", false, { USERPROFILE: home });
    rec = (readClaudeJson().projects as Record<string, Record<string, unknown>>)[proj.replace(/\\/g, "/")];
    expect(rec.enabledMcpjsonServers as string[]).toEqual([]);
    expect(rec.disabledMcpjsonServers).toEqual(["sentry"]);
  });

  it("list：待审批 = enabled/disabled 名单都没有；批准后 approved=true", async () => {
    await saveMcpServer("project", tmp, proj, "s1", { type: "http", url: "https://s1" });
    let view = await listMcpServers(tmp, proj, { USERPROFILE: home });
    expect(view.project[0].approved).toBeNull();
    await approveMcpServer(tmp, proj, "s1", true, { USERPROFILE: home });
    view = await listMcpServers(tmp, proj, { USERPROFILE: home });
    expect(view.project[0].approved).toBe(true);
  });

  it("enableAllProjectMcpServers=true 时拒绝是假动作：报错而不是静默写名单", async () => {
    writeClaudeJson({ projects: { [proj.replace(/\\/g, "/")]: { enableAllProjectMcpServers: true } } });
    await expect(approveMcpServer(tmp, proj, "s1", false, { USERPROFILE: home })).rejects.toThrow(/批准全部/);
    // 名单没被写进（假动作防住）
    const rec = (readClaudeJson().projects as Record<string, Record<string, unknown>>)[proj.replace(/\\/g, "/")];
    expect(rec.disabledMcpjsonServers).toBeUndefined();
    // 批准方向不受影响
    await approveMcpServer(tmp, proj, "s1", true, { USERPROFILE: home });
    expect((readClaudeJson().projects as Record<string, Record<string, unknown>>)[proj.replace(/\\/g, "/")].enabledMcpjsonServers).toEqual(["s1"]);
  });

  it(".mcp.json 撕裂：list 透出错误而不是静默渲染空列表", async () => {
    fs.writeFileSync(path.join(proj, ".mcp.json"), '{"mcpServers": {"a"', "utf8");
    await expect(listMcpServers(tmp, proj, { USERPROFILE: home })).rejects.toThrow(/不是合法的 JSON/);
  });
});

describe("多项目隔离（写 A 不碰 B）", () => {
  it("写 A 项目的 local scope，其余项目键与其余状态字段逐字保留", async () => {
    // 项目键用真实存在的临时目录（validateProjectPath 防线要求）
    const aDir = fs.mkdtempSync(path.join(home, "mproj-a-"));
    const bDir = fs.mkdtempSync(path.join(home, "mproj-b-"));
    const aKey = aDir.replace(/\\/g, "/");
    writeClaudeJson({
      numStartups: 7,
      projects: {
        [aKey]: { lastSessionId: "sa", mcpServers: { onlyA: { type: "stdio", command: "ca" } } },
        [bDir.replace(/\\/g, "/")]: { lastSessionId: "sb", hasTrustDialogAccepted: true },
      },
    });
    await saveMcpServer("local", tmp, aDir, "added", { type: "stdio", command: "c" }, { USERPROFILE: home });
    const projects = readClaudeJson().projects as Record<string, Record<string, unknown>>;
    expect(readClaudeJson().numStartups).toBe(7);
    expect(Object.keys(projects)).toHaveLength(2);
    expect(projects[aKey].lastSessionId).toBe("sa");
    expect(Object.keys(projects[aKey].mcpServers as Record<string, unknown>).sort()).toEqual(["added", "onlyA"]);
    // B 键逐字不动
    expect(projects[bDir.replace(/\\/g, "/")]).toEqual({ lastSessionId: "sb", hasTrustDialogAccepted: true });
  });
});

describe("读韧性", () => {
  it("半份 JSON：报错而不是静默当空对象（重试后仍失败才抛）", async () => {
    fs.writeFileSync(claudeJsonPathInHome(), '{"numStartups": 42, "mcpServers": {"a"', "utf8");
    await expect(listMcpServers(tmp, proj, { USERPROFILE: home })).rejects.toThrow(/不是合法的 JSON/);
  });
});

describe("配置校验", () => {
  it("stdio 缺 command / http 缺 url / 未知 type 拒绝", () => {
    expect(() => validateMcpConfig({ type: "stdio" })).toThrow(/command/);
    expect(() => validateMcpConfig({ type: "http" })).toThrow(/url/);
    expect(() => validateMcpConfig({ type: "grpc", command: "x" })).toThrow(/类型/);
    expect(() => validateMcpConfig({ command: "x" })).not.toThrow(); // 缺 type 按 stdio
  });
});

// fixture 取自本机 CLI 2.1.325 的 `claude mcp get codegraph` 实测输出
const MCP_GET_SAMPLE = `codegraph:
  Scope: User config (available in all your projects)
  Status: ✔ Connected
  Type: stdio
  Command: codegraph
  Args: serve --mcp

To remove this server, run: claude mcp remove codegraph -s user`;

describe("parseMcpGet", () => {
  it("解析连接态与配置字段", () => {
    const r = parseMcpGet(MCP_GET_SAMPLE);
    expect(r.error).toBeNull();
    expect(r.name).toBe("codegraph");
    expect(r.status).toBe("已连接");
    expect(r.scope).toBe("User config (available in all your projects)");
    expect(r.type).toBe("stdio");
    expect(r.command).toBe("codegraph");
    expect(r.args).toBe("serve --mcp");
    expect(r.raw).toContain("To remove this server");
  });

  it("待审批 → 待审批；失败 → 连接失败", () => {
    expect(parseMcpGet("x:\n  Status: ⏸ Pending approval").status).toBe("待审批");
    expect(parseMcpGet("x:\n  Status: ✘ Failed to connect").status).toBe("连接失败");
    expect(parseMcpGet("x:\n  Status: ✔ Connected").status).toBe("已连接");
  });

  it("空文本：字段全空，raw 为空串", () => {
    const r = parseMcpGet("  \n ");
    expect(r.name).toBeNull();
    expect(r.status).toBeNull();
    expect(r.raw).toBe("");
  });
});
