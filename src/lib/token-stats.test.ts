import { describe, expect, it } from "vitest";
import {
  cacheHitRate,
  fmtHitRate,
  fmtHitRateCompact,
  fmtTokensCompact,
  shortModel,
  type PromptTokenParts,
} from "./token-stats";

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

describe("shortModel（模型名展示简化）", () => {
  it("去掉 -日期 后缀（含日期后跟着的更多串）", () => {
    expect(shortModel("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5");
    expect(shortModel("glm-5.3-20260101123456")).toBe("glm-5.3");
  });

  it("无日期后缀的原样返回（含纯数字但不是日期的串）", () => {
    expect(shortModel("deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
    // -20 开头但不足 6 位数字不构成日期形态
    expect(shortModel("model-20")).toBe("model-20");
  });
});

describe("fmtTokensCompact（统计行紧凑 token 文本）", () => {
  it("整千/整百万位补出的 .0 剥掉", () => {
    expect(fmtTokensCompact(211_000)).toBe("211K");
    expect(fmtTokensCompact(1_000)).toBe("1K");
    expect(fmtTokensCompact(1_000_000)).toBe("1M");
  });

  it("非零小数保留（与 fmtTokens 同一刻度）", () => {
    expect(fmtTokensCompact(21_900_000)).toBe("21.9M");
    expect(fmtTokensCompact(61_900)).toBe("61.9K");
    expect(fmtTokensCompact(1_234)).toBe("1.2K");
  });

  it("千位以下取整数文本；非正数与非有限数归 0", () => {
    expect(fmtTokensCompact(999)).toBe("999");
    expect(fmtTokensCompact(0)).toBe("0");
    expect(fmtTokensCompact(-5)).toBe("0");
    expect(fmtTokensCompact(NaN)).toBe("0");
    expect(fmtTokensCompact(Infinity)).toBe("0");
  });
});

describe("fmtHitRateCompact（统计行紧凑百分比）", () => {
  it(".0% 剥成整数百分号，非零小数保留", () => {
    expect(fmtHitRateCompact(0.99)).toBe("99%");
    expect(fmtHitRateCompact(0.9213)).toBe("92.1%");
    expect(fmtHitRateCompact(1)).toBe("100%");
  });
});
