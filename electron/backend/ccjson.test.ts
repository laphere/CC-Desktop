// ccjson 单测：「读错误 ≠ 文件缺失」是全部写路径的安全前提——
// EBUSY/EPERM 被当成缺失的话，写路径会拿 {} 起步把 CLI 整份配置静默重置。
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  canonicalProjectKey,
  deepEqual,
  matchProjectKey,
  matchProjectKeys,
  readJsonObjectFile,
  validateProjectPath,
} from "./ccjson";

describe("readJsonObjectFile", () => {
  it("ENOENT 返回 null（真缺失）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccjson-test-"));
    try {
      expect(await readJsonObjectFile(path.join(dir, "nope.json"))).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("读错误（EISDIR：给个目录路径）重试后抛错，绝不折叠成 null", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccjson-test-"));
    try {
      // 对目录 readFileSync 抛 EISDIR——不是 ENOENT，必须走「重试→抛错」而不是「缺失」
      await expect(readJsonObjectFile(dir, { retries: 1, retryDelayMs: 1 })).rejects.toThrow(/读取失败/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parse 失败重试后抛错且带路径", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccjson-test-"));
    try {
      const p = path.join(dir, "torn.json");
      fs.writeFileSync(p, '{"a": 1,', "utf8");
      await expect(readJsonObjectFile(p, { retries: 1, retryDelayMs: 1 })).rejects.toThrow(/不是合法的 JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("matchProjectKeys / canonicalProjectKey", () => {
  const projects = {
    "D:/x/y": 1,
    "D:\\x\\y": 2,
    "D:/other": 3,
  };

  it("归一匹配返回全部命中键（双键并存）", () => {
    const hits = matchProjectKeys(projects, "D:\\x\\y", true);
    expect(hits.sort()).toEqual(["D:/x/y", "D:\\x\\y"]);
    expect(matchProjectKey(projects, "D:/x/y", true)).toBe("D:/x/y");
    expect(matchProjectKey(projects, "D:/nope", true)).toBeNull();
  });

  it("caseFold=false 时大小写敏感", () => {
    const p = { "D:/X/Y": 1 };
    expect(matchProjectKey(p, "D:/x/y", false)).toBeNull();
    expect(matchProjectKey(p, "D:/X/Y", false)).toBe("D:/X/Y");
  });

  it("canonicalProjectKey：resolve + 正斜杠", () => {
    expect(canonicalProjectKey("D:\\a\\b\\")).toBe("D:/a/b");
  });
});

describe("validateProjectPath", () => {
  it("拒绝非绝对路径与不存在的目录；放行真实目录", () => {
    expect(() => validateProjectPath("undefined")).toThrow(/绝对路径/);
    expect(() => validateProjectPath(null)).toThrow(/绝对路径/);
    expect(() => validateProjectPath("D:/definitely-not-exists-xyz")).toThrow(/不存在/);
    expect(validateProjectPath(os.tmpdir())).toBe(os.tmpdir());
  });
});

describe("deepEqual", () => {
  it("键序无关、嵌套与数组逐值", () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});
