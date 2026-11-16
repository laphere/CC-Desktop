// ccdisk 单测：分桶求和 + 缓存。CLAUDE_CONFIG_DIR 注入让 projects 桶落临时目录。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cleanDiskBucket, diskUsage, resetDiskUsageCache } from "./ccdisk";

let tmp: string;
let appRoot: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-test-ccdisk-"));
  appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-test-ccdisk-root-"));
  resetDiskUsageCache();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(appRoot, { recursive: true, force: true });
});

function put(p: string, size: number): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "x".repeat(size), "utf8");
}

describe("分桶", () => {
  it("各桶求和正确；cc-assets 桶取 appRoot；符号链接跳过", async () => {
    put(path.join(tmp, "projects", "p1", "a.jsonl"), 100);
    put(path.join(tmp, "file-history", "f1", "v1"), 50);
    put(path.join(tmp, "plugins", "cache", "plug", "1.0", "i.js"), 30);
    put(path.join(tmp, "plugins", "marketplaces", "m", "x"), 20);
    put(path.join(tmp, "paste-cache", "z"), 10);
    put(path.join(tmp, "history.jsonl"), 8);
    put(path.join(appRoot, "trash", "cc-assets", "t1", "skill"), 5);
    put(path.join(tmp, "cache", "misc"), 7);

    // 符号链接：指向外的链接不计入
    try {
      fs.symlinkSync(path.join(tmp, "cache"), path.join(tmp, "file-history", "loop"), "junction");
    } catch {
      /* 无权限环境跳过该断言 */
    }

    const usage = await diskUsage(tmp, appRoot, { CLAUDE_CONFIG_DIR: tmp });
    const by = (n: string) => usage.buckets.find((b) => b.name === n)?.size ?? -1;
    expect(by("sessions")).toBe(100);
    expect(by("file-history")).toBe(50);
    expect(by("plugin-cache")).toBe(30);
    expect(by("marketplaces")).toBe(20);
    expect(by("paste-cache")).toBe(10);
    expect(by("history-jsonl")).toBe(8);
    expect(by("cc-assets-trash")).toBe(5);
    expect(by("other")).toBe(7);
    expect(usage.total).toBe(100 + 50 + 30 + 20 + 10 + 8 + 5 + 7);
  });

  it("10 分钟内命中缓存（改动不反映，reset 后反映）", async () => {
    put(path.join(tmp, "history.jsonl"), 10);
    const a = await diskUsage(tmp, appRoot, { CLAUDE_CONFIG_DIR: tmp });
    put(path.join(tmp, "history.jsonl"), 20);
    // 命中缓存：返回同一引用，且新文件大小不反映
    const b = await diskUsage(tmp, appRoot, { CLAUDE_CONFIG_DIR: tmp });
    expect(a).toBe(b);
    resetDiskUsageCache();
    const c = await diskUsage(tmp, appRoot, { CLAUDE_CONFIG_DIR: tmp });
    expect(c.buckets.find((x) => x.name === "history-jsonl")!.size).toBe(20);
  });

  it("可清理标记只给白名单桶（会话/检查点/克隆/杂项不标）", async () => {
    put(path.join(tmp, "projects", "p1", "a.jsonl"), 1);
    put(path.join(tmp, "file-history", "f1"), 1);
    put(path.join(tmp, "plugins", "marketplaces", "m"), 1);
    put(path.join(tmp, "cache", "misc"), 1);
    put(path.join(tmp, "paste-cache", "z"), 1);
    const usage = await diskUsage(tmp, appRoot, { CLAUDE_CONFIG_DIR: tmp });
    const cleanable = (n: string) => usage.buckets.find((b) => b.name === n)?.cleanable === true;
    expect(cleanable("paste-cache")).toBe(true);
    expect(cleanable("history-jsonl")).toBe(true);
    expect(cleanable("sessions")).toBe(false);
    expect(cleanable("file-history")).toBe(false);
    expect(cleanable("marketplaces")).toBe(false);
    expect(cleanable("other")).toBe(false);
  });
});

describe("cleanDiskBucket", () => {
  it("目录桶：删内容、保留目录本身，返回清前大小", async () => {
    put(path.join(tmp, "paste-cache", "a", "x"), 10);
    put(path.join(tmp, "paste-cache", "b"), 5);
    const r = await cleanDiskBucket(tmp, appRoot, "paste-cache");
    expect(r.freed).toBe(15);
    expect(fs.existsSync(path.join(tmp, "paste-cache"))).toBe(true);
    expect(fs.readdirSync(path.join(tmp, "paste-cache"))).toHaveLength(0);
  });

  it("history-jsonl：截断为 0 但保留文件", async () => {
    put(path.join(tmp, "history.jsonl"), 123);
    const r = await cleanDiskBucket(tmp, appRoot, "history-jsonl");
    expect(r.freed).toBe(123);
    expect(fs.existsSync(path.join(tmp, "history.jsonl"))).toBe(true);
    expect(fs.statSync(path.join(tmp, "history.jsonl")).size).toBe(0);
  });

  it("白名单外的桶一律拒绝（sessions 必须走回收站）", async () => {
    put(path.join(tmp, "projects", "p1", "a.jsonl"), 10);
    await expect(cleanDiskBucket(tmp, appRoot, "sessions")).rejects.toThrow(/不允许清理/);
    await expect(cleanDiskBucket(tmp, appRoot, "file-history")).rejects.toThrow(/不允许清理/);
    await expect(cleanDiskBucket(tmp, appRoot, "marketplaces")).rejects.toThrow(/不允许清理/);
    await expect(cleanDiskBucket(tmp, appRoot, "other")).rejects.toThrow(/不允许清理/);
    // 拒绝后原数据不动
    expect(fs.existsSync(path.join(tmp, "projects", "p1", "a.jsonl"))).toBe(true);
  });

  it("清理后失效用量缓存（磁盘页不继续显示旧大小）", async () => {
    put(path.join(tmp, "paste-cache", "x"), 10);
    const before = await diskUsage(tmp, appRoot, { CLAUDE_CONFIG_DIR: tmp });
    expect(before.buckets.find((b) => b.name === "paste-cache")!.size).toBe(10);
    await cleanDiskBucket(tmp, appRoot, "paste-cache");
    const after = await diskUsage(tmp, appRoot, { CLAUDE_CONFIG_DIR: tmp });
    expect(after.buckets.find((b) => b.name === "paste-cache")!.size).toBe(0);
  });

  it("清理跳过符号链接（不删链接目标）", async () => {
    put(path.join(tmp, "elsewhere", "keep"), 7);
    put(path.join(tmp, "paste-cache", "real"), 3);
    try {
      fs.symlinkSync(path.join(tmp, "elsewhere"), path.join(tmp, "paste-cache", "link"), "junction");
    } catch {
      return; // 无权限环境跳过
    }
    const r = await cleanDiskBucket(tmp, appRoot, "paste-cache");
    expect(r.freed).toBe(3); // 链接本身不计大小
    expect(fs.existsSync(path.join(tmp, "elsewhere", "keep"))).toBe(true);
    expect(fs.readdirSync(path.join(tmp, "paste-cache"))).toHaveLength(1); // 只剩链接
  });
});
