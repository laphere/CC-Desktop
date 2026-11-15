import { describe, expect, it } from "vitest";
import { highlightKeyword, keywordRanges, normalizeKeyword } from "./keyword-highlight";

describe("normalizeKeyword", () => {
  it("trim + 连续空白折叠单空格 + lowercase", () => {
    expect(normalizeKeyword("  Hello   World  ")).toBe("hello world");
    expect(normalizeKeyword("a\t\n b")).toBe("a b");
    expect(normalizeKeyword("")).toBe("");
    expect(normalizeKeyword("   ")).toBe("");
  });
});

describe("keywordRanges", () => {
  it("无命中返回空数组", () => {
    expect(keywordRanges("hello world", "xyz")).toEqual([]);
    expect(keywordRanges("", "x")).toEqual([]);
  });

  it("空关键词不产生区间", () => {
    expect(keywordRanges("abc", "")).toEqual([]);
  });

  it("大小写不敏感的字面匹配", () => {
    expect(keywordRanges("Hello HELLO hello", "hello")).toEqual([
      [0, 5],
      [6, 11],
      [12, 17],
    ]);
  });

  it("按出现顺序、不重叠", () => {
    expect(keywordRanges("aaaa", "aa")).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("emoji 等代理对按码元下标切分（与后端 indexOf 口径一致）", () => {
    // 😀 是代理对（2 个码元），关键词从其后的文本开始
    const text = "😀😀needle";
    expect(keywordRanges(text, "needle")).toEqual([[4, 10]]);
  });

  it("命中在开头/末尾", () => {
    expect(keywordRanges("foobar", "foo")).toEqual([[0, 3]]);
    expect(keywordRanges("foobar", "bar")).toEqual([[3, 6]]);
  });
});

describe("highlightKeyword", () => {
  it("空关键词 / 无命中返回原字符串", () => {
    expect(highlightKeyword("abc", "")).toBe("abc");
    expect(highlightKeyword("abc", undefined)).toBe("abc");
    expect(highlightKeyword("abc", "xyz")).toBe("abc");
  });

  it("多命中切成节点数组，mark 保留原文大小写", () => {
    const nodes = highlightKeyword("a foo b FOO", "foo") as Array<{
      type?: string;
      props?: { children?: string };
    }>;
    expect(Array.isArray(nodes)).toBe(true);
    const marks = nodes.filter((n) => n.type === "mark");
    expect(marks).toHaveLength(2);
    expect(marks[0].props?.children).toBe("foo");
    expect(marks[1].props?.children).toBe("FOO");
  });
});
