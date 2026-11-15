// 文件路径识别正则测试：识别面（盘符/POSIX/~/相对）与拒绝面（裸文件名/子串/尾标点）。
// linkifyFilePaths / 手势委托依赖 DOM（vitest node 环境不进单测，同 links.ts 的口径），
// 这里只测纯函数面：PATH_RE、trimProsePrefix 与 previewablePath。
import { describe, expect, it } from "vitest";
import { PATH_RE, previewablePath, trimProsePrefix } from "./file-links";

function matched(text: string): string[] {
  return Array.from(text.matchAll(PATH_RE)).map((m) => m[0]);
}

describe("PATH_RE 识别面", () => {
  it("Windows 盘符路径（inline code 与裸文本同串）", () => {
    const t = "详见 D:\\MyWorkspaces\\geo\\plans\\a.packed.html 好的";
    expect(matched(t)).toEqual(["D:\\MyWorkspaces\\geo\\plans\\a.packed.html"]);
  });

  it("POSIX 绝对路径与 ~ 路径", () => {
    expect(matched("报告在 /Users/laphe/reports/report.md 里")).toEqual([
      "/Users/laphe/reports/report.md",
    ]);
    expect(matched("见 ~/docs/x.md")).toEqual(["~/docs/x.md"]);
  });

  it("相对路径（模型常写 docs/x.md，解析根由 ChatView 佩项目）", () => {
    expect(matched("更新到 docs/usage-2026.md 了")).toEqual(["docs/usage-2026.md"]);
    expect(matched("D:/x/y.html 的反斜杠正斜杠都认")).toEqual(["D:/x/y.html"]);
  });

  it("一段文本里的多个命中", () => {
    expect(matched("docs/a.md 和 docs/b.md")).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("路径中段含点目录（a.b/report.md）", () => {
    expect(matched("D:\\a.b\\report.md")).toEqual(["D:\\a.b\\report.md"]);
  });

  it("惰性收口取第一个白名单扩展名（.html.bak / a.md.html 的行为钉住）", () => {
    expect(matched("docs/x.htm.bak")).toEqual(["docs/x.htm"]);
    expect(matched("docs/a.md.html")).toEqual(["docs/a.md"]);
  });

  it("大写扩展名与 ~\\ 变体", () => {
    expect(matched("D:\\x\\REPORT.MD 是大写")).toEqual(["D:\\x\\REPORT.MD"]);
    expect(matched("见 ~\\a\\b.md")).toEqual(["~\\a\\b.md"]);
  });
});

describe("PATH_RE 拒绝面", () => {
  it("裸文件名不当路径（无分隔符，歧义太大）", () => {
    expect(matched("看 topbar-search-prototype.html")).toEqual([]);
  });

  it("扩展名是别的串的子串不命中（\\b 词边界）", () => {
    expect(matched("output.report.mds 不是 md")).toEqual([]);
    expect(matched("index.htmlx")).toEqual([]);
  });

  it("非白名单扩展名不命中", () => {
    expect(matched("read docs/notes.txt")).toEqual([]);
  });

  it("尾部标点留在路径外（中文句号/括号/逗号）", () => {
    expect(matched("写到了 D:\\x\\a.md。")).toEqual(["D:\\x\\a.md"]);
    expect(matched("docs/c.md，")).toEqual(["docs/c.md"]);
  });

  it("全角标点包裹的路径（括号是行文包裹，不进路径）", () => {
    expect(matched("（docs/b.md）")).toEqual(["docs/b.md"]);
    expect(matched("「docs/d.md」")).toEqual(["docs/d.md"]);
  });

  it("行文黏连的绝对路径按头部裁剪（相对路径不猜）", () => {
    // 纯正则匹配会带前缀；wrapTextNode 里的 trimProsePrefix 只对盘符头裁。
    // 这里直接验证正则产物 + 裁剪语义由 DOM 层承担（本文件只测纯函数面），
    // 相对黏连「更新到docs/x.md」保持原样是已知边界（不猜「方案」是不是目录名）
    expect(matched("路径在D:\\x\\a.md")).toEqual(["路径在D:\\x\\a.md"]);
    expect(matched("（docs/b.md）")).toEqual(["docs/b.md"]);
  });
});

describe("trimProsePrefix（行文黏连裁剪）", () => {
  it("盘符黏连裁到盘符头", () => {
    expect(trimProsePrefix("路径在D:\\x\\a.md")).toBe("D:\\x\\a.md");
    expect(trimProsePrefix("详见D:\\geo\\x.html")).toBe("D:\\geo\\x.html");
  });

  it("POSIX 绝对与相对路径的黏连不裁（不猜 CJK 目录名）", () => {
    expect(trimProsePrefix("详见/Users/x/a.md")).toBe("详见/Users/x/a.md");
    expect(trimProsePrefix("更新到方案/架构.md")).toBe("更新到方案/架构.md");
    expect(trimProsePrefix("docs/b.md")).toBe("docs/b.md");
    expect(trimProsePrefix("~/docs/x.md")).toBe("~/docs/x.md");
  });

  it("ASCII 括号黏连：无配对右括号才剥（配对 = 带括号的合法目录名）", () => {
    expect(trimProsePrefix("(docs/b.md")).toBe("docs/b.md");
    expect(trimProsePrefix("(docs/b.md)")).toBe("(docs/b.md)");
    expect(trimProsePrefix("D:\\a(b)\\c.md")).toBe("D:\\a(b)\\c.md");
  });
});

describe("previewablePath（与主进程白名单同表）", () => {
  it("白名单内放行（大小写不敏感）", () => {
    expect(previewablePath("D:\\x\\a.md")).toBe(true);
    expect(previewablePath("a.MD")).toBe(true);
    expect(previewablePath("/u/x/b.html")).toBe(true);
    expect(previewablePath("c.htm")).toBe(true);
  });

  it("白名单外拒绝（含无扩展名与敏感的 config.json）", () => {
    expect(previewablePath("a.txt")).toBe(false);
    expect(previewablePath("config.json")).toBe(false);
    expect(previewablePath("README")).toBe(false);
  });
});
