// 文件预览读侧测试：扩展名白名单 / 大小上限 / 前探兜底 / 读错误冒泡
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isPreviewablePath, previewStat, readPreviewFile, resolveUserPath } from "./files";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-test-files-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("resolveUserPath", () => {
  it("相对路径佩上 base（跨平台用 path.sep 拼样例，不写死分隔符）", () => {
    const rel = ["docs", "x.md"].join(path.sep);
    const resolved = resolveUserPath(rel, tmp);
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved.endsWith(rel)).toBe(true);
  });

  it("绝对路径不受 base 影响（盘符/根开头照原样归一）", () => {
    const abs = path.resolve(tmp, "a.md");
    expect(resolveUserPath(abs, tmp)).toBe(path.normalize(abs));
  });

  it("~ 展开为用户主目录（~/ 与 ~\\ 两种写法）", () => {
    expect(resolveUserPath("~")).toBe(os.homedir());
    const home = resolveUserPath("~" + path.sep + "x.md");
    expect(home.startsWith(os.homedir())).toBe(true);
    expect(home.endsWith("x.md")).toBe(true);
  });

  it("无 base 的相对路径原样返回（渲染层没传项目根，交由系统报错）", () => {
    expect(resolveUserPath("x.md")).toBe("x.md");
  });

  const itWin = process.platform === "win32" ? it : it.skip;
  itWin("无盘符 rooted 绝对路径落回 base 相对拼接（POSIX 风格多半来自别的平台）", () => {
    expect(resolveUserPath("/x.md", tmp)).toBe(path.normalize(path.join(tmp, "x.md")));
    expect(resolveUserPath("\\sub\\y.md", tmp)).toBe(
      path.normalize(path.join(tmp, "sub", "y.md")),
    );
  });
  itWin("UNC 头（\\\\srv\\share）是真正的 rooted，不落 base", () => {
    expect(resolveUserPath("\\\\srv\\share\\a.md", tmp)).toBe(
      path.normalize("\\\\srv\\share\\a.md"),
    );
  });
  itWin("无 base 的 rooted 原样归一（大概率 ENOENT，安全失败）", () => {
    expect(resolveUserPath("/x.md")).toBe(path.normalize("/x.md"));
  });

  it(".. 穿越按 base 解析（方案内行为：用户自己项目的文件，pin 住防误收紧）", () => {
    const r = resolveUserPath(path.join("..", "x.md"), tmp);
    expect(path.isAbsolute(r)).toBe(true);
    expect(r.startsWith(tmp)).toBe(false);
  });

  it("白名单判定发生在解析之后（base + 相对路径端到端）", () => {
    const sub = path.join(tmp, "sub");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, "a.md"), "# x");
    expect(readPreviewFile(path.join("sub", "a.md"), tmp).content).toBe("# x");
    fs.writeFileSync(path.join(sub, "c.json"), "{}");
    expect(() => readPreviewFile(path.join("sub", "c.json"), tmp)).toThrow(/json/);
  });
});

describe("isPreviewablePath", () => {
  it("白名单扩展名放行（大小写不敏感）", () => {
    expect(isPreviewablePath("D:\\x\\report.md")).toBe(true);
    expect(isPreviewablePath("D:\\x\\page.html")).toBe(true);
    expect(isPreviewablePath("/home/u/a.htm")).toBe(true);
    expect(isPreviewablePath("D:\\x\\REPORT.MD")).toBe(true);
  });

  it("白名单外一律拒绝（含无扩展名与 config.json 这类敏感文件）", () => {
    expect(isPreviewablePath("D:\\x\\notes.txt")).toBe(false);
    expect(isPreviewablePath("D:\\x\\config.json")).toBe(false);
    expect(isPreviewablePath("D:\\x\\README")).toBe(false);
  });
});

describe("previewStat", () => {
  it("常规文件返回存在 + isFile + 字节数", () => {
    const file = path.join(tmp, "a.md");
    fs.writeFileSync(file, "你好".repeat(10));
    const st = previewStat(file);
    expect(st.exists).toBe(true);
    expect(st.isFile).toBe(true);
    expect(st.size).toBe(fs.statSync(file).size);
  });

  it("目录 isFile=false；不存在一律归为 exists=false 不抛错（resolved 仍回传）", () => {
    const dir = path.join(tmp, "sub");
    fs.mkdirSync(dir);
    expect(previewStat(dir).isFile).toBe(false);
    const raw = path.join(tmp, "nope.md");
    const missing = previewStat(raw);
    expect(missing.exists).toBe(false);
    expect(missing.isFile).toBe(false);
    expect(missing.resolved).toBe(path.normalize(raw));
  });
});

describe("readPreviewFile", () => {
  it("正常读 utf-8 内容（带解析后的绝对路径）", () => {
    const file = path.join(tmp, "a.md");
    fs.writeFileSync(file, "# 标题\n\n正文", "utf8");
    const r = readPreviewFile(file);
    expect(r.content).toBe("# 标题\n\n正文");
    expect(r.resolved).toBe(path.normalize(file));
  });

  it("白名单外 throw（扩展名进错误信息）", () => {
    const file = path.join(tmp, "b.json");
    fs.writeFileSync(file, "{}");
    expect(() => readPreviewFile(file)).toThrow(/json/);
  });

  it("目录 throw", () => {
    const dir = path.join(tmp, "sub.md");
    fs.mkdirSync(dir);
    expect(() => readPreviewFile(dir)).toThrow(/常规文件/);
  });

  it("超过 10MB 上限 throw（用 truncate 制造稀疏大文件，不真写盘）", () => {
    const file = path.join(tmp, "big.html");
    fs.writeFileSync(file, "<html></html>");
    fs.truncateSync(file, 10 * 1024 * 1024 + 1);
    expect(() => readPreviewFile(file)).toThrow(/上限/);
  });

  it("恰好 10MB 不超限", () => {
    const file = path.join(tmp, "edge.md");
    fs.writeFileSync(file, "x");
    fs.truncateSync(file, 10 * 1024 * 1024);
    expect(() => readPreviewFile(file)).not.toThrow();
  });

  it("不存在的文件 ENOENT 冒泡（渲染层据错误文案提示）", () => {
    expect(() => readPreviewFile(path.join(tmp, "gone.md"))).toThrow();
  });
});
