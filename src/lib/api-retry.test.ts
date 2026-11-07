import { describe, expect, it } from "vitest";
import {
  apiRetryDelayMs,
  apiRetryReason,
  apiRetryStatusText,
  apiRetryTooltip,
  type ApiRetryEvent,
} from "./api-retry";

/** 用例统一写全字段；只改关心的那几项 */
const retry = (over: Partial<ApiRetryEvent> = {}): ApiRetryEvent => ({
  type: "api_retry",
  attempt: 2,
  maxRetries: 10,
  retryDelayMs: 1160,
  error: "unknown",
  status: null,
  noResponse: null,
  ...over,
});

describe("apiRetryReason（失败原因）", () => {
  it("error_status 为 null = 连接层错误（没有 HTTP 响应）", () => {
    expect(apiRetryReason(retry())).toBe("连接失败");
  });

  it("no_response 存在时是首字节超时，不是连接被拒", () => {
    expect(apiRetryReason(retry({ noResponse: { waitedMs: 45000, retryWaitMs: 700 } }))).toBe(
      "响应超时",
    );
  });

  it("限流与过载按 error 区分，其余看状态码", () => {
    expect(apiRetryReason(retry({ status: 429, error: "rate_limit" }))).toBe("请求受限");
    expect(apiRetryReason(retry({ status: 529, error: "overloaded" }))).toBe("服务过载");
    expect(apiRetryReason(retry({ status: 500, error: "server_error" }))).toBe("请求失败（HTTP 500）");
  });
});

describe("apiRetryDelayMs（本次要等多久）", () => {
  it("首字节超时用 retry_wait_ms，其余用 retry_delay_ms", () => {
    expect(apiRetryDelayMs(retry())).toBe(1160);
    expect(apiRetryDelayMs(retry({ noResponse: { waitedMs: 45000, retryWaitMs: 700 } }))).toBe(700);
  });
});

describe("apiRetryStatusText（状态胶囊文案）", () => {
  it("连接失败：次数 + 向上取整的退避秒数", () => {
    // 1160ms 在界面上显示 2s（向上取整，不把「马上」说成「0 秒」）
    expect(apiRetryStatusText(retry())).toBe("连接失败 · 重试 2/10 · 2s 后重试");
  });

  it("传入倒计时剩余量时按剩余量显示（300ms → 1s，0 → 等待重试…）", () => {
    expect(apiRetryStatusText(retry(), 300)).toBe("连接失败 · 重试 2/10 · 1s 后重试");
    expect(apiRetryStatusText(retry(), 0)).toBe("连接失败 · 重试 2/10 · 等待重试…");
  });

  it("首字节超时用 no_response 的等待时长，而不是 retry_delay_ms", () => {
    expect(
      apiRetryStatusText(
        retry({ attempt: 1, maxRetries: 1, retryDelayMs: 20000, noResponse: { waitedMs: 45000, retryWaitMs: 700 } }),
      ),
    ).toBe("响应超时 · 重试 1/1 · 1s 后重试");
  });

  it("有上限才写「/N」，退避为 0 时不编等待时间", () => {
    expect(apiRetryStatusText(retry({ attempt: 3, maxRetries: 0, retryDelayMs: 0 }))).toBe(
      "连接失败 · 重试 3",
    );
  });

  it("字段全缺（老 CLI / 残帧）也只说「正在重试」，不显示 0/0", () => {
    expect(apiRetryStatusText(retry({ attempt: 0, maxRetries: 0, retryDelayMs: 0 }))).toBe(
      "连接失败 · 正在重试",
    );
  });
});

describe("apiRetryTooltip（悬停提示）", () => {
  it("带上限、毫秒退避与错误类别", () => {
    expect(apiRetryTooltip(retry({ status: 529, error: "overloaded", retryDelayMs: 9391 }))).toBe(
      "服务过载；第 2 次重试（上限 10 次）；退避 9391ms；错误：overloaded",
    );
  });

  it("首字节超时展示已等待与下次等待，不展示不适用的 retry_delay_ms", () => {
    expect(
      apiRetryTooltip(
        retry({ attempt: 1, maxRetries: 1, retryDelayMs: 20000, noResponse: { waitedMs: 45000, retryWaitMs: 700 } }),
      ),
    ).toBe("响应超时；第 1 次重试（上限 1 次）；已等待响应 45000ms，下次等待 700ms");
  });

  it("零值字段不编成真实读数：全缺时只剩失败原因", () => {
    expect(
      apiRetryTooltip(retry({ attempt: 0, maxRetries: 0, retryDelayMs: 0 })),
    ).toBe("连接失败");
  });

  it("哨兵 error:unknown 不展示（它就是连接层错误的默认值）", () => {
    expect(apiRetryTooltip(retry())).toBe("连接失败；第 2 次重试（上限 10 次）；退避 1160ms");
  });

  it("未知上限时不补「上限 0 次」", () => {
    expect(apiRetryTooltip(retry({ maxRetries: 0 }))).toBe(
      "连接失败；第 2 次重试；退避 1160ms",
    );
  });
});
