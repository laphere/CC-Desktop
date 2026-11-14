import { describe, expect, it } from "vitest";
import { settleStaleThinking } from "./chat-items";
import type { ChatItem } from "../types";

/** 用例里只关心 thinking 条目，窄化取字段 */
const asThink = (it: ChatItem) => (it.kind === "thinking" ? it : null);

/** now 钉成常量：冻结值可以断等值，不用量级断言 */
const NOW = 1_000_000_000_000;

/** 开流中的 thinking 条目（content_start 刚建、起点在 ms 之前；startedAt 可缺） */
let nextId = 1;
const streamingThink = (startedAt: number | undefined, durationMs?: number): ChatItem => ({
  id: nextId++,
  kind: "thinking",
  text: "",
  streaming: true,
  ...(startedAt !== undefined ? { startedAt } : {}),
  ...(durationMs !== undefined ? { durationMs } : {}),
});

describe("settleStaleThinking（断流残块的活秒表定稿）", () => {
  it("流式中的 thinking 按 startedAt 冻结实测时长并翻 streaming=false", () => {
    const out = settleStaleThinking([streamingThink(NOW - 8000)], NOW);
    const th = asThink(out[0]);
    expect(th?.streaming).toBe(false);
    expect(th?.durationMs).toBe(8000);
  });

  it("startedAt 落在 now 之后（异常帧）按 0 冻结，不出负数", () => {
    const out = settleStaleThinking([streamingThink(NOW + 5000)], NOW);
    expect(out).toHaveLength(1);
    expect(asThink(out[0])?.durationMs).toBe(0);
  });

  it("没有 startedAt 的残块只翻 streaming、不编时长", () => {
    const out = settleStaleThinking([streamingThink(undefined)], NOW);
    const th = asThink(out[0]);
    expect(th?.streaming).toBe(false);
    expect(th?.durationMs).toBeUndefined();
  });

  it("已定稿的条目（durationMs 已落）原样保留，不被更大的活秒表值覆盖", () => {
    const items = [streamingThink(NOW - 60000, 5000)];
    expect(settleStaleThinking(items, NOW)).toEqual(items);
    expect(settleStaleThinking(items, NOW)[0]).toBe(items[0]);
  });

  it("非 thinking 与非流式条目不动；全无残块时返回原引用", () => {
    const items: ChatItem[] = [
      { id: nextId++, kind: "text", text: "hi", streaming: false },
      streamingThink(NOW - 5000),
    ];
    const settled = items.map((it) =>
      it.kind === "thinking" ? { ...it, streaming: false } : it,
    );
    expect(settleStaleThinking(settled, NOW)).toBe(settled);
  });

  it("多个残块一起定稿，混在文本/工具条目之间互不干扰", () => {
    const text: ChatItem = { id: nextId++, kind: "text", text: "中", streaming: true };
    const tool: ChatItem = {
      id: nextId++,
      kind: "tool_use",
      toolUseId: "t1",
      name: "Bash",
      input: null,
      hasResult: true,
      isError: false,
    };
    const out = settleStaleThinking(
      [streamingThink(NOW - 20000), text, streamingThink(NOW - 3000), tool],
      NOW,
    );
    expect(out[1]).toBe(text);
    expect(out[3]).toBe(tool);
    expect(asThink(out[0])?.durationMs).toBe(20000);
    expect(asThink(out[2])?.durationMs).toBe(3000);
  });
});
