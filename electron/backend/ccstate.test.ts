// ccstate 单测：停用暂存的往返是「停用→再启用」闭环的根（评审 P0 的回归锚）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readCcState, writeCcState, type DisabledHookEntry } from "./ccstate";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-test-ccstate-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ENTRY: DisabledHookEntry = {
  id: "user|Stop|abc",
  scope: "user",
  event: "Stop",
  entry: { hooks: [{ type: "command", command: "echo done" }] },
};

describe("ccstate 往返", () => {
  it("写读往返：条目内容逐字保真（再启用靠它还原）", () => {
    writeCcState(tmp, [ENTRY]);
    const state = readCcState(tmp);
    expect(state.disabledHooks).toHaveLength(1);
    expect(state.disabledHooks[0].id).toBe(ENTRY.id);
    expect(state.disabledHooks[0].scope).toBe("user");
    expect(state.disabledHooks[0].event).toBe("Stop");
    expect(state.disabledHooks[0].entry).toEqual(ENTRY.entry);
  });

  it("文件缺失 = 空清单；坏 JSON 内存按空处理且**不重置磁盘文件**", () => {
    expect(readCcState(tmp).disabledHooks).toEqual([]);
    const p = path.join(tmp, "ccstate.json");
    fs.writeFileSync(p, "{oops", "utf8");
    expect(readCcState(tmp).disabledHooks).toEqual([]);
    expect(fs.readFileSync(p, "utf8")).toBe("{oops"); // 原文件还在
  });

  it("BOM 容忍；旧形态（字符串数组）条目被滤掉不炸", () => {
    const p = path.join(tmp, "ccstate.json");
    fs.writeFileSync(p, "\uFEFF" + JSON.stringify({ disabledHooks: [ENTRY] }), "utf8");
    expect(readCcState(tmp).disabledHooks).toHaveLength(1);
    // 早期构建存过纯 id 字符串——没有内容无法还原，滤掉而非崩溃
    fs.writeFileSync(p, JSON.stringify({ disabledHooks: ["user|Stop|abc"] }), "utf8");
    expect(readCcState(tmp).disabledHooks).toEqual([]);
  });
});
