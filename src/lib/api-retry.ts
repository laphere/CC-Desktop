/**
 * 模型请求失败、CLI 自动重试时的状态胶囊文案（纯逻辑）。
 *
 * 数据来自 `system` + subtype:"api_retry" 帧：attempt / max_retries、retry_delay_ms、
 * error（SDKAssistantMessageError）、error_status（HTTP 状态码）与可选的 no_response。
 * 界面只把帧里的数字翻译成人话，**不推导重试策略**：上限与退避由 CLI 决定，
 * 前端另算一套只会在两边不一致时骗用户。
 */

import type { ChatEvent } from "../types";

export type ApiRetryEvent = Extract<ChatEvent, { type: "api_retry" }>;

/** 这次重试要等多久（毫秒）。首字节超时走 no_response 的 retry_wait_ms——d.ts 明确
 *  那条路径的 retry_delay_ms 不适用（max_retries 也是它自己的小上限） */
export function apiRetryDelayMs(r: ApiRetryEvent): number {
  return r.noResponse?.retryWaitMs ?? r.retryDelayMs;
}

/** 失败原因（胶囊前缀）。连接层错误没有 HTTP 响应（error_status:null），与服务端
 *  返回错误码要分开说——前者是网络/代理，后者看状态码就知道该等还是该改配置 */
export function apiRetryReason(r: ApiRetryEvent): string {
  if (r.noResponse) return "响应超时";
  if (r.status === null) return "连接失败";
  if (r.error === "rate_limit") return "请求受限";
  if (r.error === "overloaded") return "服务过载";
  if (r.status > 0) return `请求失败（HTTP ${r.status}）`;
  return "请求失败";
}

/** 状态胶囊主文案。remainingMs 是倒计时剩余量（前端每秒重算）；不传则按帧里的
 *  原始退避显示。退避为 0（字段缺失）时不编等待时间，只说「正在重试」 */
export function apiRetryStatusText(r: ApiRetryEvent, remainingMs?: number): string {
  const attempt =
    r.attempt > 0 ? (r.maxRetries > 0 ? `${r.attempt}/${r.maxRetries}` : String(r.attempt)) : "";
  const base = `${apiRetryReason(r)}${attempt ? ` · 重试 ${attempt}` : " · 正在重试"}`;
  const delay = apiRetryDelayMs(r);
  if (delay <= 0) return base;
  const wait = remainingMs ?? delay;
  return wait > 0 ? `${base} · ${Math.max(1, Math.ceil(wait / 1000))}s 后重试` : `${base} · 等待重试…`;
}

/** 悬停提示：补上胶囊放不下的错误类别与毫秒退避。零值字段不编成真实读数，
 *  哨兵 "unknown" 也不展示（连接层错误就是它，说「未知错误」反而像多了一重故障） */
export function apiRetryTooltip(r: ApiRetryEvent): string {
  const parts = [apiRetryReason(r)];
  if (r.attempt > 0) {
    parts.push(`第 ${r.attempt} 次重试${r.maxRetries > 0 ? `（上限 ${r.maxRetries} 次）` : ""}`);
  }
  if (r.noResponse) {
    parts.push(`已等待响应 ${r.noResponse.waitedMs}ms，下次等待 ${r.noResponse.retryWaitMs}ms`);
  } else if (r.retryDelayMs > 0) {
    parts.push(`退避 ${r.retryDelayMs}ms`);
  }
  if (r.error && r.error !== "unknown") parts.push(`错误：${r.error}`);
  return parts.join("；");
}
