import { describe, expect, it } from "vitest";
import { cacheHitRate, fmtHitRate, type PromptTokenParts } from "./token-stats";

/** 用例统一写全字段，读起来就是「输入 / 读缓存 / 写缓存」三段 */
const parts = (inputTokens: number, cacheReadInputTokens: number, cacheCreationInputTokens: number) => ({
  inputTokens,
  cacheReadInputTokens,
  cacheCreationInputTokens,
});

describe("cacheHitRate（缓存命中率 = 缓存读取 / 提示词总量）", () => {
  it("分母是三个桶之和：输入 + 缓存读取 + 缓存写入", () => {
    // 10 + 80 + 10 = 100，命中 80%
    expect(cacheHitRate(parts(10, 80, 10))).toBeCloseTo(0.8, 10);
  });

  it("输出 token 不参与（顺手传进来的 outputTokens 不影响结果）", () => {
    const withOut: PromptTokenParts & { outputTokens: number } = {
      ...parts(10, 80, 10),
      outputTokens: 999_999,
    };
    expect(cacheHitRate(withOut)).toBeCloseTo(0.8, 10);
  });

  it("全命中 = 1（输入与写入都为 0 的纯读缓存轮）", () => {
    expect(cacheHitRate(parts(0, 500, 0))).toBe(1);
  });

  it("一次没命中 = 0（只有首次写缓存 + 冷输入）", () => {
    expect(cacheHitRate(parts(100, 0, 400))).toBe(0);
  });

  it("分母为 0 → null（没有提示词 token，无从谈命中率，调用方不渲染）", () => {
    expect(cacheHitRate(parts(0, 0, 0))).toBeNull();
  });

  it("缺失/NaN/负数按 0 处理，不把统计带成 NaN", () => {
    expect(
      cacheHitRate({
        inputTokens: Number.NaN,
        cacheReadInputTokens: 40,
        cacheCreationInputTokens: -5,
      }),
    ).toBe(1);
    // jsonl 里 usage 字段可能写成 null：类型面不允许，运行时却真会来（结构化断言走 cast）
    const nullish = {
      inputTokens: null,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
    } as unknown as PromptTokenParts;
    expect(cacheHitRate(nullish)).toBeNull();
  });

  it("真实量级：本会话 868.5K 输入 / 10.5M 缓存读取 / 少量写入 ≈ 九成以上", () => {
    const rate = cacheHitRate(parts(868_500, 10_500_000, 200_000))!;
    expect(rate).toBeGreaterThan(0.85);
    expect(rate).toBeLessThan(1);
  });
});

describe("fmtHitRate（统计行里的百分比文本）", () => {
  it("固定一位小数", () => {
    expect(fmtHitRate(0.8)).toBe("80.0%");
    expect(fmtHitRate(0.9213)).toBe("92.1%");
    expect(fmtHitRate(1)).toBe("100.0%");
    expect(fmtHitRate(0)).toBe("0.0%");
  });

  it("0.9995 这一类四舍五入到 100.0% 是预期的（显示层不做「>99.9%」的额外写法）", () => {
    expect(fmtHitRate(0.99996)).toBe("100.0%");
  });
});
