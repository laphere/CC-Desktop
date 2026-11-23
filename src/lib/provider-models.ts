// 供应商「模型槽位」的唯一定义处：设置中心（ProviderDialog）与会话级选择器
// （ProviderModelPicker）共用，避免两处各写一份 envKey/标签而漂移。
//
// 槽位值就是供应商 settingsConfig.env 里对应键的值；一个供应商通常把多个槽位
// 指向同一个模型（本机实测 opus/fable/sonnet 全指向同一个 id），所以读取时按
// 模型值去重、保留首个槽位标签。

export interface ProviderModelSlot {
  /** 槽位 key（与 ProviderDialog 的表单字段对应） */
  key: string;
  /** settingsConfig.env 里的键名 */
  envKey: string;
  /** 界面标签 */
  label: string;
}

/** 槽位表用 as const 钉成字面量联合——这样别处 `Record<槽位 key, …>]` 才有穷尽性，
 *  新增槽位却忘了同步附加字段会直接编译报错（而不是运行期静默丢字段）。 */
export const PROVIDER_MODEL_SLOTS = [
  { key: "model", envKey: "ANTHROPIC_MODEL", label: "默认模型" },
  { key: "sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", label: "Sonnet" },
  { key: "opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL", label: "Opus" },
  { key: "fable", envKey: "ANTHROPIC_DEFAULT_FABLE_MODEL", label: "Fable" },
  { key: "haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL", label: "Haiku" },
  { key: "subagent", envKey: "CLAUDE_CODE_SUBAGENT_MODEL", label: "子代理" },
] as const satisfies readonly ProviderModelSlot[];

export type ProviderModelSlotKey = (typeof PROVIDER_MODEL_SLOTS)[number]["key"];

export interface ProviderModelEntry {
  slotKey: string;
  slotLabel: string;
  model: string;
}

/** 从 settingsConfig.env 读出该供应商**配置过**的模型（去重、保序）；
 *  只读 string 值——数字/空串不算「配了」。 */
export function providerModelEntries(
  settingsConfig: Record<string, unknown>,
): ProviderModelEntry[] {
  // 防御旧数据/导入条目：settingsConfig 理论上总是对象（config.ts 归一过），
  // 但真出现 null 时这里抛 TypeError 会让整个选择器渲染崩掉
  if (!settingsConfig || typeof settingsConfig !== "object") return [];
  const env = settingsConfig.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return [];
  const obj = env as Record<string, unknown>;
  const seen = new Set<string>();
  const out: ProviderModelEntry[] = [];
  for (const slot of PROVIDER_MODEL_SLOTS) {
    const v = obj[slot.envKey];
    if (typeof v !== "string" || v === "" || seen.has(v)) continue;
    seen.add(v);
    out.push({ slotKey: slot.key, slotLabel: slot.label, model: v });
  }
  return out;
}
