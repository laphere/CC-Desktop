/**
 * token 统计的派生量（纯逻辑，供会话页头部统计行使用）。
 *
 * 现有口径（见 CLAUDE.md「token 统计」条）：**每会话聚合、翻页不影响数字**，
 * usage 取每条消息的**代表行**（收尾行优先，不逐行相加）。
 *
 * 这里只做「从已聚合的 usage 里算出缓存命中率」这一件事，不碰聚合本身——
 * 分子分母都来自同一次口径的累加，否则（比如分子取收尾行、分母逐行相加）
 * 会算出一个 >100% 的假命中率。
 */

/** 参与命中率计算的提示词维度（Anthropic 的 input_tokens **不含**缓存两项，
 *  两者是并列的三个桶：未命中缓存的输入 / 缓存读取 / 缓存写入） */
export interface PromptTokenParts {
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** 非数字/负数/NaN 一律按 0 处理：jsonl 里 usage 字段缺失或写成 null 时不能把整行统计带成 NaN */
function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 缓存命中率 = 缓存读取 / 提示词总 token（输入 + 缓存读取 + 缓存写入）。
 *
 * 分母为什么不含输出：命中率衡量的是「这次请求的上下文有多少直接来自缓存」，
 * 输出 token 是新生成的、与缓存无关（含进去会让长回答的命中率被稀释成一半以下，
 * 与「上下文复用度」这个直觉脱钩）。
 *
 * 返回 0~1；**分母为 0 时返回 null**（没有任何提示词 token，无从谈命中率；
 * 调用方据此不渲染，而不是显示 0.0%）。
 */
export function cacheHitRate(u: PromptTokenParts): number | null {
  const input = num(u.inputTokens);
  const read = num(u.cacheReadInputTokens);
  const write = num(u.cacheCreationInputTokens);
  const prompt = input + read + write;
  if (prompt <= 0) return null;
  const rate = read / prompt;
  // 理论上 read ≤ prompt 恒成立；浮点边界上夹一下，避免出现 100.0% 以上的怪值
  return rate < 0 ? 0 : rate > 1 ? 1 : rate;
}

/** 命中率百分比文本：「92.1%」，固定一位小数。统计行实际用的是下面的
 *  fmtHitRateCompact（剥掉整数的 .0），本函数是它的底座；固定小数位的初衷是
 *  统计行里数字挨在一起，位数跳动会让整行左右抖（fmtTokens 的单位也同理固定） */
export function fmtHitRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** 模型名简化：去掉 -20250514 日期后缀（hover 可看全名）。日期后缀对人是噪声，
 *  但判等、落库等场景要用原串——本函数只用于**展示** */
export function shortModel(m: string): string {
  return m.replace(/-20\d{6,8}.*$/, "");
}

/** 末位恰为「.0」时剥掉（"211.0" → "211"，"21.9" 原样） */
function trimTenthZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** 紧凑 token 文本（头部统计行专用）：与 MessageParts 的 fmtTokens 同一缩写刻度
 *  （1234 → 1.2K），但整千/整百万补出的「.0」不显示（211.0K → 211K）。
 *  不复用 fmtTokens 本体：它被思考估算、「本次」徽标、tooltip 等多处共用，
 *  恒一位小数是那边的行为，在这里改会把「.0」涟漪出去 */
export function fmtTokensCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${trimTenthZero((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `${trimTenthZero((n / 1_000).toFixed(1))}K`;
  return String(Math.round(n));
}

/** 命中率百分比文本的紧凑变体：99.0% → 99%，非零小数保留（92.1% 原样） */
export function fmtHitRateCompact(rate: number): string {
  return fmtHitRate(rate).replace(/\.0%$/, "%");
}
