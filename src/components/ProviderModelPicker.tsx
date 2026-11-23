import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, LockIcon, SearchIcon } from "./Icons";
import type { ProviderListState } from "../types";
import { providerModelEntries } from "../lib/provider-models";

/** 一次选择：providerId 为 null = 跟随全局 settings.json */
export interface ProviderChoice {
  providerId: string | null;
  model: string | null;
}

interface Props {
  /** 供应商清单（null = 还在加载） */
  state: ProviderListState | null;
  value: ProviderChoice;
  /** 锁定态：进程已启动 / 续聊已定，不可再改（仍显示当前选择） */
  disabled?: boolean;
  onChange: (v: ProviderChoice) => void;
}

/** 触发按钮的显示文案：跟随配置时点名当前供应商；选了供应商就带模型名 */
function buttonLabel(state: ProviderListState | null, value: ProviderChoice): string {
  if (value.providerId === null) {
    const cur = state?.providers.find((p) => p.id === state.currentId);
    return cur ? `当前 · ${cur.name}` : "当前供应商";
  }
  const p = state?.providers.find((x) => x.id === value.providerId);
  // 记录里的供应商已被删掉：resolveSessionProviderEnv 会退回「跟随全局」，显示别撒谎
  if (!p) return "原供应商已删除 · 跟随配置";
  return value.model ? `${p.name} · ${value.model}` : p.name;
}

/**
 * 会话级「供应商 + 模型」下拉（首条消息前可改，之后锁定）。
 *
 * 结构与 ModePicker 同款：自绘按钮 + 向上弹面板（输入卡片贴着窗口底部，往下弹会出屏），
 * 复用 .mode-picker/.mode-panel 那套 class 与开合动画。面板里：
 * - 首项「当前供应商（跟随 Claude Code 配置）」= 不注入，CLI 走全局 settings.json；
 * - 其余按供应商分组，列出该供应商**配置里声明过**的模型（去重，见 provider-models.ts）。
 *
 * ⚠️ Esc 守卫在 ChatView 里查 `.mode-panel[data-open="true"]`，本组件必须沿用 .mode-panel
 * 类名，否则一次 Esc 会既关面板又把本轮打断。
 */
export default function ProviderModelPicker({ state, value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 点外面 / Esc 关掉（与 ModePicker 同一套；Esc 那条让 ChatView 的全局守卫接手也行，
  // 但面板里有可能聚焦搜索框，这里再兜一层更稳）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // 组词中的 Esc 是「取消候选」，不许顺手关面板（与 ChatView 全局那道同口径）
      if (e.key === "Escape" && !e.isComposing) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 锁定（进程已起 / starting）时关掉面板：正常点击路径会被 outside-mousedown 顺带关，
  // 但键盘路径可能留着展开的面板、选项仍可点，导致注入完成后显示被改写。
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const currentName = state?.providers.find((p) => p.id === state.currentId)?.name ?? "";

  /** 供展开的条目：跟随配置 + 各供应商（含其模型）。搜索时按供应商名/模型 id 过滤。 */
  const groups = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    return state.providers
      .map((p) => {
        const models = providerModelEntries(p.settingsConfig);
        const hitSelf = !q || p.name.toLowerCase().includes(q);
        const kept = hitSelf ? models : models.filter((m) => m.model.toLowerCase().includes(q));
        return { provider: p, models: kept, hitSelf };
      })
      .filter((g) => g.hitSelf || g.models.length > 0);
  }, [state, query]);

  const pick = (v: ProviderChoice) => {
    setOpen(false);
    setQuery("");
    onChange(v);
  };

  const label = buttonLabel(state, value);

  return (
    <div className="mode-picker provider-model-picker" ref={wrapRef}>
      <button
        type="button"
        className="chat-mode"
        disabled={disabled || state === null}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) window.setTimeout(() => searchRef.current?.focus(), 0);
        }}
        title={
          disabled
            ? "会话已启动，供应商不可更改（模型仍可在右侧热切）"
            : "选择本会话用的供应商与模型（首条消息前可改）"
        }
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="mode-label">{state === null ? "读取中…" : label}</span>
        {disabled ? (
          <LockIcon size={11} className="mode-lock" />
        ) : (
          <span className="mode-arrow">
            <ChevronDownIcon size={12} />
          </span>
        )}
      </button>

      <div className="mode-panel provider-model-panel" data-open={open} role="listbox">
        <div className="pmp-search">
          <SearchIcon size={12} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索供应商或模型"
            spellCheck={false}
          />
        </div>

        <button
          type="button"
          role="option"
          aria-selected={value.providerId === null}
          className={`mode-item${value.providerId === null ? " active" : ""}`}
          onClick={() => pick({ providerId: null, model: null })}
        >
          <CheckIcon size={12} className="pmp-check" />
          <span className="pmp-main">
            <span className="pmp-title">当前供应商（跟随 Claude Code 配置）</span>
            {currentName && <span className="pmp-sub">{currentName}</span>}
          </span>
        </button>

        {groups.map((g) => (
          <div className="pmp-group" key={g.provider.id}>
            <button
              type="button"
              role="option"
              aria-selected={value.providerId === g.provider.id && value.model === null}
              className={`mode-item pmp-provider${
                value.providerId === g.provider.id && value.model === null ? " active" : ""
              }`}
              title={`${g.provider.name}（用它的默认模型）`}
              onClick={() => pick({ providerId: g.provider.id, model: null })}
            >
              <CheckIcon size={12} className="pmp-check" />
              <span className="pmp-main">
                <span className="pmp-title">{g.provider.name}</span>
              </span>
            </button>
            {g.models.map((m) => {
              const active = value.providerId === g.provider.id && value.model === m.model;
              return (
                <button
                  type="button"
                  key={`${g.provider.id}:${m.model}`}
                  role="option"
                  aria-selected={active}
                  className={`mode-item pmp-model${active ? " active" : ""}`}
                  title={`${g.provider.name} · ${m.slotLabel} → ${m.model}`}
                  onClick={() => pick({ providerId: g.provider.id, model: m.model })}
                >
                  <CheckIcon size={12} className="pmp-check" />
                  <span className="pmp-main">
                    <span className="pmp-slot">{m.slotLabel}</span>
                    <span className="pmp-model-name">{m.model}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        {state !== null && groups.length === 0 && (
          <div className="mode-hint">没有匹配的供应商或模型</div>
        )}
      </div>
    </div>
  );
}
