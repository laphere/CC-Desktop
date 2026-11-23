// 会话域增强命令单元测试（不读真实 ~/.claude，全部用临时目录造 fixture）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  searchSessionMessages,
  searchSessions,
  getSessionUserPrompts,
  exportSession,
  renderSessionMarkdown,
  purgeClaudeProjectData,
  listPinnedSessions,
  MAX_SEARCH_HITS,
  MAX_SESSION_SEARCH_RESULTS,
  type SessionMessage,
} from "./session-extra";
import { mangleProjectPath } from "./mangle";

const UUID_A = "5426d6d0-c08f-43bd-94df-4d6d99e5c699";
const UUID_B = "0f3c6dd8-7a12-4b3e-9c5a-1d2e3f4a5b6c";
const UUID_C = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

let tmp: string;
let projects: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-extra-"));
  projects = path.join(tmp, "projects");
  fs.mkdirSync(projects);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 把一条 Claude Code 会话行写成 JSONL（type 即 role，content 可为字符串或块数组） */
function line(type: "user" | "assistant", content: unknown, model?: string): string {
  return JSON.stringify({
    type,
    message: { role: type, content },
    timestamp: "2026-08-12T06:47:46.519Z",
    ...(model ? { model } : {}),
  });
}

function writeSession(uuid: string, lines: string[]): string {
  const p = path.join(projects, uuid + ".jsonl");
  fs.writeFileSync(p, lines.join("\n") + "\n", "utf8");
  return p;
}

// ---------------------------------------------------------------------------
// 1. 搜索：跳过 thinking / tool_result，命中 text + tool_use 输入
// ---------------------------------------------------------------------------
describe("searchSessionMessages", () => {
  it("跳过 thinking 与 tool_result，只命中 text 与 tool_use 输入", () => {
    const p = writeSession(UUID_A, [
      line("user", "find needle here"),
      line("assistant", [{ type: "thinking", thinking: "needle in thought" }]),
      line("assistant", [{ type: "tool_result", content: "needle in result", tool_use_id: "t1" }]),
      line("assistant", [{ type: "tool_use", name: "Grep", id: "t1", input: { pattern: "needle" } }], "claude-opus"),
    ]);
    const hits = searchSessionMessages(p, "needle", projects);
    expect(hits.length).toBe(2);
    expect(hits[0].index).toBe(0);
    expect(hits[0].kind).toBe("user");
    expect(hits[0].snippet).toContain("needle");
    expect(hits[0].snippet).not.toContain("\n");
    // 第 4 条是 tool_use（index=3），命中其 input
    expect(hits[1].index).toBe(3);
    expect(hits[1].snippet).toContain("needle");
  });

  it("大小写不敏感", () => {
    const p = writeSession(UUID_A, [line("user", "Find NEEDLE here")]);
    expect(searchSessionMessages(p, "needle", projects).length).toBe(1);
  });

  it("空关键词返回空", () => {
    const p = writeSession(UUID_A, [line("user", "anything")]);
    expect(searchSessionMessages(p, "   ", projects)).toEqual([]);
  });

  it("命中上限为 MAX_SEARCH_HITS (200)", () => {
    const lines: string[] = [];
    for (let i = 0; i < 250; i++) lines.push(line("user", `line ${i} needle`));
    const p = writeSession(UUID_A, lines);
    const hits = searchSessionMessages(p, "needle", projects);
    expect(hits.length).toBe(MAX_SEARCH_HITS);
  });

  it("路径穿越被拒（文件在 projectsDir 之外直接抛错）", () => {
    const outside = path.join(tmp, UUID_A + ".jsonl");
    fs.writeFileSync(outside, line("user", "needle"), "utf8");
    expect(() => searchSessionMessages(outside, "needle", projects)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 1.5 跨项目全局会话搜索（顶栏搜索的会话档；快档 / 全文档两档 + 早停截断）
// ---------------------------------------------------------------------------
describe("searchSessions", () => {
  /** 会话写入 mangled 项目子目录（searchSessions 枚举的是 <projects>/<mangled>/） */
  function writeProjectSession(projectPath: string, uuid: string, lines: string[]): string {
    const dir = path.join(projects, mangleProjectPath(projectPath));
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, uuid + ".jsonl");
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf8");
    return p;
  }

  const PROJ_A = "D:\\ws\\alpha";
  const PROJ_B = "D:\\ws\\beta";

  it("标题命中收录（结果形状与置顶区元数据同构）", async () => {
    writeProjectSession(PROJ_A, UUID_A, [
      line("user", "讨论这里的细节"),
      '{"type":"ai-title","aiTitle":"趋势图台账聚合"}',
    ]);
    const out = await searchSessions(projects, "台账", [PROJ_A]);
    expect(out.results.length).toBe(1);
    expect(out.truncated).toBe(false);
    expect(out.results[0].projectPath).toBe(PROJ_A);
    expect(out.results[0].title).toBe("趋势图台账聚合");
    expect(out.results[0].summary).toBe("讨论这里的细节");
    expect(out.results[0].file).toBe(path.join(projects, mangleProjectPath(PROJ_A), UUID_A + ".jsonl"));
  });

  it("摘要命中也收录（标题不含关键词）", async () => {
    writeProjectSession(PROJ_A, UUID_A, [
      line("user", "别的什么问题"),
      '{"type":"summary","summary":"关于台账的总结"}',
    ]);
    const out = await searchSessions(projects, "台账", [PROJ_A]);
    expect(out.results.length).toBe(1);
  });

  it("大小写不敏感 + 连续空白折叠（foo  bar 命中 foo bar）", async () => {
    writeProjectSession(PROJ_A, UUID_A, [
      line("user", "讨论数据同步"),
      '{"type":"ai-title","aiTitle":"fix FOO  BAR flow"}',
    ]);
    const out = await searchSessions(projects, "foo  bar", [PROJ_A]);
    expect(out.results.length).toBe(1);
  });

  it("无命中返回空；空关键词直接短路", async () => {
    writeProjectSession(PROJ_A, UUID_A, [line("user", "普通内容")]);
    expect((await searchSessions(projects, "不存在词", [PROJ_A])).results.length).toBe(0);
    expect(await searchSessions(projects, "  ", [PROJ_A])).toEqual({
      results: [],
      truncated: false,
    });
  });

  it("口径与 listSessions 同源：侧链 / 空 mangled 路径 / 目录缺失均静默跳过", async () => {
    // 侧链会话不展示（首行 isSidechain）
    writeProjectSession(PROJ_A, UUID_A, [
      '{"parentUuid":null,"isSidechain":true,"type":"user","message":{"role":"user","content":"台账子会话"}}',
    ]);
    const out = await searchSessions(projects, "台账", [PROJ_A, "", PROJ_B]);
    expect(out.results.length).toBe(0); // PROJ_B 目录根本没建，也不抛错
  });

  it("「未命名会话」占位标题不召回（摘要命中不受影响）", async () => {
    // 只有 summary 行、没有用户消息 → title 落到占位词「未命名会话」
    writeProjectSession(PROJ_A, UUID_A, ['{"type":"summary","summary":"台账相关总结"}']);
    expect((await searchSessions(projects, "未命名", [PROJ_A])).results.length).toBe(0);
    expect((await searchSessions(projects, "台账", [PROJ_A])).results.length).toBe(1);
  });

  it("正文命中不召回：标题/摘要不含关键词时，正文（text / tool_use 输入）命中也不出", async () => {
    // 会话 1：正文 text 命中；会话 2：tool_use 输入命中——都不该进结果
    writeProjectSession(PROJ_A, UUID_A, [
      line("user", "修一下登录"),
      line("assistant", [
        { type: "thinking", thinking: "台账在 thought 里" },
        { type: "tool_result", content: "台账在 result 里" },
        { type: "text", text: "把台账导出改成流式" },
      ]),
      '{"type":"ai-title","aiTitle":"登录修复"}',
    ]);
    writeProjectSession(PROJ_A, UUID_B, [
      line("user", "跑一下搜索"),
      line("assistant", [{ type: "tool_use", name: "Grep", id: "t1", input: { pattern: "台账" } }]),
      '{"type":"ai-title","aiTitle":"跑搜索"}',
    ]);
    const out = await searchSessions(projects, "台账", [PROJ_A]);
    expect(out.results.length).toBe(0); // 内容级搜索由会话页内的 search_session_messages 承担
  });

  it("跨项目按 mtime 倒序合并（同毫秒按路径次级键）", async () => {
    const older = writeProjectSession(PROJ_A, UUID_A, [
      line("user", "x"),
      '{"type":"ai-title","aiTitle":"台账旧会话"}',
    ]);
    const newer = writeProjectSession(PROJ_B, UUID_B, [
      line("user", "y"),
      '{"type":"ai-title","aiTitle":"台账新会话"}',
    ]);
    const base = Date.now();
    fs.utimesSync(older, new Date(base), new Date(base - 60_000));
    fs.utimesSync(newer, new Date(base), new Date(base));
    const out = await searchSessions(projects, "台账", [PROJ_A, PROJ_B]);
    expect(out.results.length).toBe(2);
    expect(out.results[0].projectPath).toBe(PROJ_B); // 新的在前
    expect(out.results[1].projectPath).toBe(PROJ_A);
  });

  it("mangle 碰撞去重：两条路径变体落同一目录，会话只收录一次", async () => {
    // b_x 与 b-x 经 mangle（_ 与字面 - 都映射为 -）落进同一目录
    writeProjectSession("D:\\a\\b_x", UUID_A, [
      line("user", "n"),
      '{"type":"ai-title","aiTitle":"台账唯一"}',
    ]);
    const out = await searchSessions(projects, "台账", ["D:\\a\\b_x", "D:\\a\\b-x"]);
    expect(out.results.length).toBe(1);
  });

  it("上限早停：恰好满 50 不算截断，51 条截断为最新的前 50（全局排序后截断）", async () => {
    const base = Date.now();
    const write = (n: number) => {
      const id = "5426d6d0-c08f-43bd-94df-" + n.toString(16).padStart(12, "0");
      const p = writeProjectSession(PROJ_A, id, [
        line("user", "c" + n),
        `{"type":"ai-title","aiTitle":"批量标题会话 ${n}"}`,
      ]);
      // i 越大越旧：新→旧 = 0,1,2,...
      fs.utimesSync(p, new Date(base), new Date(base - n * 60_000));
    };
    for (let n = 0; n < MAX_SESSION_SEARCH_RESULTS; n++) write(n);
    const full = await searchSessions(projects, "批量", [PROJ_A]);
    expect(full.results.length).toBe(MAX_SESSION_SEARCH_RESULTS);
    expect(full.truncated).toBe(false);
    expect(full.results[0].title).toBe("批量标题会话 0"); // 最新的在前

    write(MAX_SESSION_SEARCH_RESULTS); // 第 51 条（最旧）
    const over = await searchSessions(projects, "批量", [PROJ_A]);
    expect(over.results.length).toBe(MAX_SESSION_SEARCH_RESULTS);
    expect(over.truncated).toBe(true);
    expect(over.results[0].title).toBe("批量标题会话 0");
    expect(over.results[MAX_SESSION_SEARCH_RESULTS - 1].title).toBe(
      `批量标题会话 ${MAX_SESSION_SEARCH_RESULTS - 1}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. 用户发言提取：跳过命令消息
// ---------------------------------------------------------------------------
describe("getSessionUserPrompts", () => {
  it("跳过命令消息（含标记/中断提示），返回可定位的 index", () => {
    const p = writeSession(UUID_A, [
      line("user", "真实问题 A"),
      // 带 command-message 标记的文本块：消息会被 parse 收录，但须被显式跳过
      line("user", [{ type: "text", text: "<command-message>/init</command-message> 初始化" }]),
      line("assistant", [{ type: "text", text: "助手回复" }]),
      line("user", [{ type: "text", text: "<local-command-stdout>done</local-command-stdout> 收尾" }]),
      line("user", "真实问题 B"),
      line("user", "[Request interrupted by user]"),
    ]);
    const prompts = getSessionUserPrompts(p, projects);
    expect(prompts.length).toBe(2);
    expect(prompts[0].index).toBe(0);
    expect(prompts[0].text).toBe("真实问题 A");
    expect(prompts[1].index).toBe(4);
    expect(prompts[1].text).toBe("真实问题 B");
    expect(prompts[0].timestamp).toBe("2026-08-12T06:47:46.519Z");
  });

  it("无用户发言时返回空", () => {
    const p = writeSession(UUID_A, [line("assistant", "only assistant")]);
    expect(getSessionUserPrompts(p, projects)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. 导出：Markdown 四种块形态 / JSONL 字节数
// ---------------------------------------------------------------------------
describe("renderSessionMarkdown", () => {
  const msgs: SessionMessage[] = [
    { kind: "user", blocks: [{ kind: "text", text: "Hello world" }], timestamp: "2026-08-12T06:47:46.519Z" },
    {
      kind: "assistant",
      model: "claude-opus-4",
      blocks: [
        { kind: "thinking", text: "deep thought", durationMs: 8300 },
        { kind: "tool_use", name: "Grep", input: { pattern: "foo" }, toolUseId: "t1" },
        { kind: "tool_result", text: "y".repeat(250), toolUseId: "t1" },
        { kind: "image" },
      ],
    },
  ];

  it("四种块形态：text 原样 / thinking 引用块（带时长）/ tool_use 摘要 / tool_result 截断 200 / image 占位", () => {
    const md = renderSessionMarkdown(msgs, "我的会话");
    expect(md).toContain("# 我的会话");
    expect(md).toContain("Hello world");
    expect(md).toContain("> 💭 思考过程 · 8 秒（省略）");
    expect(md).toContain("🔧 Grep · foo");
    // tool_result 用 tool_use_id 反查到工具名 Grep，并截断到 200 字符 + …
    expect(md).toMatch(/📄 Grep 结果：y{200}…/);
    expect(md).toContain("🖼️ [图片]");
  });

  it("thinking 时长不足 1 秒不显示（两份手写格式化的共用守卫路径）", () => {
    const md = renderSessionMarkdown(
      [{ kind: "assistant", blocks: [{ kind: "thinking", text: "x", durationMs: 500 }] }],
      "短思考",
    );
    expect(md).toContain("> 💭 思考过程（省略）");
    expect(md).not.toContain("秒");
  });

  it("标题缺省回退「未命名会话」", () => {
    const md = renderSessionMarkdown(msgs, "");
    expect(md).toContain("# 未命名会话");
  });
});

describe("exportSession", () => {
  it("jsonl 原样复制，返回字节数（含多字节字符）", () => {
    const content = '{"type":"user"}\n{"中文":"内容"}\n';
    const p = writeSession(UUID_A, [content.trim()]);
    const dest = path.join(tmp, "out.jsonl");
    const bytes = exportSession(p, dest, "jsonl", projects);
    expect(bytes).toBe(Buffer.from(content, "utf8").length);
    expect(fs.readFileSync(dest, "utf8")).toBe(content);
  });

  it("markdown 导出解析标题并写入文件", () => {
    const p = writeSession(UUID_A, [
      '{"type":"ai-title","aiTitle":"我的标题","sessionId":"' + UUID_A + '"}',
      line("user", "正文内容"),
    ]);
    const dest = path.join(tmp, "out.md");
    exportSession(p, dest, "markdown", projects);
    expect(fs.readFileSync(dest, "utf8")).toContain("# 我的标题");
  });

  it("导出目标不能是会话文件本身（大小写不敏感）", () => {
    const p = writeSession(UUID_A, [line("user", "x")]);
    expect(() => exportSession(p, p.toUpperCase(), "jsonl", projects)).toThrow();
  });

  it("不支持的格式抛错", () => {
    const p = writeSession(UUID_A, [line("user", "x")]);
    expect(() => exportSession(p, path.join(tmp, "o.txt"), "pdf", projects)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. 清除失效项目数据
// ---------------------------------------------------------------------------
describe("purgeClaudeProjectData", () => {
  it("删除真实路径已消失的项目目录，返回删除数", () => {
    const deadPath = "D:\\dead\\proj";
    const deadDir = path.join(projects, mangleProjectPath(deadPath));
    fs.mkdirSync(deadDir, { recursive: true });
    fs.writeFileSync(path.join(deadDir, UUID_A + ".jsonl"), "{}");
    const removed = purgeClaudeProjectData([deadPath], projects);
    expect(removed).toBe(1);
    expect(fs.existsSync(deadDir)).toBe(false);
  });

  it("真实路径仍存活的项目跳过不删", () => {
    const alivePath = path.join(tmp, "alive-proj");
    fs.mkdirSync(alivePath);
    const aliveDir = path.join(projects, mangleProjectPath(alivePath));
    fs.mkdirSync(aliveDir, { recursive: true });
    const removed = purgeClaudeProjectData([alivePath], projects);
    expect(removed).toBe(0);
    expect(fs.existsSync(aliveDir)).toBe(true);
  });

  it("onBeforeDelete 只在真正删除前触发（未删的路径不误报）", () => {
    const deadPath = "D:\\dead\\proj2";
    fs.mkdirSync(path.join(projects, mangleProjectPath(deadPath)), { recursive: true });
    const alivePath = path.join(tmp, "alive-proj2");
    fs.mkdirSync(alivePath);
    fs.mkdirSync(path.join(projects, mangleProjectPath(alivePath)), { recursive: true });
    const fired: string[] = [];
    const removed = purgeClaudeProjectData([deadPath, alivePath], projects, (p) => fired.push(p));
    expect(removed).toBe(1);
    expect(fired).toEqual([deadPath]);
  });

  it("只删精确同名目录，相似名字兄弟目录无恙", () => {
    const dirProj = path.join(projects, mangleProjectPath("Proj"));
    const dirProj2 = path.join(projects, mangleProjectPath("Proj2"));
    fs.mkdirSync(dirProj, { recursive: true });
    fs.mkdirSync(dirProj2, { recursive: true });
    const removed = purgeClaudeProjectData(["Proj"], projects);
    expect(removed).toBe(1);
    expect(fs.existsSync(dirProj)).toBe(false);
    expect(fs.existsSync(dirProj2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. 置顶会话清单：顺序保持 + 缺失文件静默跳过
// ---------------------------------------------------------------------------
describe("listPinnedSessions", () => {
  function writePinned(uuid: string, title: string): string {
    const p = path.join(projects, uuid + ".jsonl");
    fs.writeFileSync(
      p,
      [
        line("user", "首条发言"),
        '{"type":"custom-title","customTitle":"' + title + '","sessionId":"' + uuid + '"}',
      ].join("\n") + "\n",
      "utf8",
    );
    return p;
  }

  it("按清单顺序实时解析；缺失文件静默跳过", () => {
    const fileA = writePinned(UUID_A, "标题A");
    const fileB = writePinned(UUID_B, "标题B");
    const missing = path.join(projects, UUID_C + ".jsonl");
    const pins = [
      { file: fileB, projectPath: "P2" }, // 故意把 B 排在 A 前
      { file: fileA, projectPath: "P1" },
      { file: missing, projectPath: "P3" },
    ];
    const out = listPinnedSessions(projects, pins);
    expect(out.length).toBe(2);
    expect(out[0].file).toBe(fileB);
    expect(out[0].title).toBe("标题B");
    expect(out[0].projectPath).toBe("P2");
    expect(out[1].file).toBe(fileA);
    expect(out[1].title).toBe("标题A");
    expect(out[1].projectPath).toBe("P1");
    expect(typeof out[0].lastModified).toBe("number");
  });

  it("非 jsonl / 非 uuid 文件名条目被跳过", () => {
    const fileA = writePinned(UUID_A, "标题A");
    const pins = [
      { file: fileA, projectPath: "P1" },
      { file: path.join(projects, "notes.txt"), projectPath: "P2" },
    ];
    const out = listPinnedSessions(projects, pins);
    expect(out.length).toBe(1);
    expect(out[0].file).toBe(fileA);
  });
});

describe("搜索片段的下标口径（码元 vs 码点）", () => {
  it("命中处前面有代理对时片段窗口不缩水", () => {
    // hit 来自 indexOf（UTF-16 码元），切片按码点。混用会让窗口整体前移
    // （实测 3 个 emoji 时少 3 个字符）。这里 5 个 emoji = 10 个码元。
    const prefix = "😀".repeat(5);
    const body = "a".repeat(50);
    const p = writeSession(UUID_A, [line("user", `${prefix}${body}NEEDLE`)]);
    const hits = searchSessionMessages(p, "NEEDLE", projects);
    expect(hits.length).toBe(1);
    // 命中前恰好保留 radius=40 个字符（不含 emoji，emoji 在窗口之外）
    expect(hits[0].snippet).toBe("a".repeat(40) + "NEEDLE");
  });

  it("关键词本身含代理对时命中长度正确（不吞掉后面的字符）", () => {
    const p = writeSession(UUID_A, [line("user", `${"x".repeat(10)}🔍needle${"y".repeat(10)}`)]);
    const hits = searchSessionMessages(p, "🔍needle", projects);
    expect(hits.length).toBe(1);
    expect(hits[0].snippet).toContain("🔍needle");
    expect(hits[0].snippet).toContain("y");
  });

  it("中文（BMP，1 码元 = 1 码点）行为不变", () => {
    const p = writeSession(UUID_A, [line("user", `${"中文".repeat(30)}关键词`)]);
    const hits = searchSessionMessages(p, "关键词", projects);
    expect(hits.length).toBe(1);
    expect(hits[0].snippet).toContain("关键词");
  });
});
