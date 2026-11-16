import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listPromptHistory } from "./cchistory";

let tmp = "";

function put(lines: string[]): void {
  fs.writeFileSync(path.join(tmp, "history.jsonl"), lines.join("\n"), "utf8");
}

function row(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("listPromptHistory", () => {
  it("缺文件返回空，不报错", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cchist-"));
    const r = await listPromptHistory(tmp);
    expect(r).toEqual({ entries: [], total: 0 });
  });

  it("解析字段并按 timestamp 倒序", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cchist-"));
    put([
      row({ display: "第一条", project: "/p/a", sessionId: "s1", timestamp: 1000 }),
      row({ display: "第二条", project: "/p/b", sessionId: "s2", timestamp: 3000, pastedContents: { x: 1 } }),
      row({ display: "第三条", timestamp: 2000 }),
    ]);
    const r = await listPromptHistory(tmp, { limit: 10 });
    expect(r.total).toBe(3);
    expect(r.entries.map((e) => e.display)).toEqual(["第二条", "第三条", "第一条"]);
    expect(r.entries[0].hasPaste).toBe(true);
    expect(r.entries[0].sessionId).toBe("s2");
    expect(r.entries[1].project).toBeNull();
  });

  it("搜索大小写不敏感且只作用于 display", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cchist-"));
    put([
      row({ display: "Hello World", project: "/p", timestamp: 1 }),
      row({ display: "别的", project: "/p", timestamp: 2 }),
    ]);
    const r = await listPromptHistory(tmp, { search: "hello" });
    expect(r.total).toBe(1);
    expect(r.entries[0].display).toBe("Hello World");
    // 搜索词不出现在 display 时，即使 project 命中也不算
    const r2 = await listPromptHistory(tmp, { search: "/p" });
    expect(r2.total).toBe(0);
  });

  it("limit 截断但 total 为过滤后总数", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cchist-"));
    const lines = Array.from({ length: 50 }, (_, i) =>
      row({ display: `d${i}`, timestamp: i + 1 }),
    );
    put(lines);
    const r = await listPromptHistory(tmp, { limit: 10 });
    expect(r.entries).toHaveLength(10);
    expect(r.total).toBe(50);
    expect(r.entries[0].display).toBe("d49");
  });

  it("坏行 / 半行 / 缺 timestamp 的行被跳过", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cchist-"));
    put([
      "{ 半行",
      row({ display: "没时间", timestamp: undefined }),
      row({ display: "好的", timestamp: 5 }),
      "[]",
      "null",
    ]);
    const r = await listPromptHistory(tmp);
    expect(r.total).toBe(1);
    expect(r.entries[0].display).toBe("好的");
  });

  it("limit 上限被夹到 1000", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cchist-"));
    put(Array.from({ length: 3 }, (_, i) => row({ display: `d${i}`, timestamp: i })));
    const r = await listPromptHistory(tmp, { limit: 99999 });
    expect(r.entries).toHaveLength(3);
  });
});
