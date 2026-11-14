// 设置中心「配置」域页面：权限规则 / Hooks / CLAUDE.md / 磁盘占用。
// 写路径全部即时落盘（单条增删 = 一次小写入），失败 toast + 重读。
import { useEffect, useMemo, useState } from "react";
import { PencilIcon, XIcon } from "../Icons";
import { api } from "../../lib/api";
import type {
  AssetScope,
  CcScope,
  CcPermsRead,
  CcHooksRead,
  ClaudeMdView,
  DisabledHookEntry,
  DiskUsage,
  HooksMap,
  PermissionRules,
} from "../../../electron/ipc-contract";
import {
  Badge,
  Card,
  EffectiveHint,
  EmptyState,
  fmtBytes,
  H3,
  Hint,
  LoadOrError,
  Toggle,
  useAsync,
  WarnBanner,
} from "./shared";

const PROJECT_NEEDED = "项目级管理请从项目行右键菜单「项目扩展与规则」进入";

// ================= 权限规则 =================

function RuleChips({ rules, onRemove }: { rules: string[]; onRemove: (rule: string) => void }) {
  if (rules.length === 0) return <Hint>暂无规则</Hint>;
  return (
    <div className="cc-chips">
      {rules.map((r, i) => (
        <span key={`${r}-${i}`} className="cc-chip">
          <span className="mono">{r}</span>
          <button type="button" className="cc-chip-x" title="删除规则" onClick={() => onRemove(r)}>
            <XIcon size={10} />
          </button>
        </span>
      ))}
    </div>
  );
}

function RuleGroup({
  title,
  badge,
  rules,
  onChange,
}: {
  title: string;
  badge: string;
  rules: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...rules, v]);
    setDraft("");
  };
  return (
    <div className="cc-rule-group">
      <H3 right={<Badge kind="mut">{badge}</Badge>}>{title}</H3>
      <RuleChips rules={rules} onRemove={(r) => onChange(rules.filter((x) => x !== r))} />
      <div className="cc-addrow">
        <input
          className="cc-input mono"
          placeholder="规则如 Bash(git push:*) 或 Edit(src/**)，回车添加"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" className="btn btn-sm" onClick={add}>
          添加
        </button>
      </div>
    </div>
  );
}

export function PermsPage({ scope, projectPath, onToast }: { scope: CcScope; projectPath: string | null; onToast?: (m: string) => void }) {
  const { data, error, loading, reload } = useAsync<CcPermsRead>(
    () => api.ccPermsRead(projectPath ?? undefined),
    [projectPath],
  );
  // 本地编辑副本：加载/重读后按当前 scope 取对应组
  const [rules, setRules] = useState<PermissionRules | null>(null);
  const scopeKey = scope;
  useEffect(() => {
    if (!data) return;
    setRules(scopeKey === "user" ? data.user : data.project ?? { allow: [], deny: [], ask: [] });
  }, [data, scopeKey]);

  if (error || loading) return <LoadOrError loading={loading} error={error}>{null}</LoadOrError>;
  if (scope === "project" && !projectPath) return <Hint>{PROJECT_NEEDED}</Hint>;
  if (!data || !rules) return null;

  const persist = async (next: PermissionRules) => {
    setRules(next);
    try {
      await api.ccPermsWrite(scope, { allow: next.allow, deny: next.deny, ask: next.ask }, projectPath ?? undefined);
      // 重读以磁盘为准：否则 scope 往返会回到挂载时的陈旧快照，
      // 下一次保存把陈旧集合整表写回、静默抹掉刚保存的改动
      reload();
    } catch (e) {
      onToast?.(`保存权限规则失败：${String(e)}`);
      reload();
    }
  };

  const dm = data.defaultMode;
  return (
    <>
      <H3 right={dm.mode ? <Badge kind="star">{dm.mode}</Badge> : <Badge kind="mut">跟随 CLI 默认</Badge>}>
        默认档位（permissions.defaultMode，只读）
      </H3>
      <Hint>
        {dm.mode
          ? `生效值 ${dm.mode} 来自${
              dm.source === "local" ? "项目 settings.local.json" : dm.source === "project" ? "项目 settings.json" : "用户级 settings.json"
            }；app 内对话「不改选档位」时按它定。`
          : "三级 settings 都没配 defaultMode，会话初始档位由 CLI 自身默认决定。"}
      </Hint>

      <RuleGroup title="允许（allow）" badge="命中即自动批准" rules={rules.allow} onChange={(next) => persist({ ...rules, allow: next })} />
      <RuleGroup title="询问（ask）" badge="命中即弹确认" rules={rules.ask} onChange={(next) => persist({ ...rules, ask: next })} />
      <RuleGroup title="拒绝（deny）" badge="命中即拒绝" rules={rules.deny} onChange={(next) => persist({ ...rules, deny: next })} />

      {(rules.additionalDirectories?.length ?? 0) > 0 && (
        <div className="cc-rule-group">
          <H3 right={<Badge kind="mut">只读（CLI 维护）</Badge>}>附加目录（additionalDirectories）</H3>
          <div className="cc-chips">
            {rules.additionalDirectories!.map((d) => (
              <span key={d} className="cc-chip">
                <span className="mono">{d}</span>
              </span>
            ))}
          </div>
          <Hint>允许会话访问工作区之外的目录；增删请在 Claude Code 内操作。</Hint>
        </div>
      )}

      <EffectiveHint />
    </>
  );
}

// ================= Hooks =================

/** hook 条目的稳定 id：scope + 事件 + 序号 + 内容摘要（停用暂存的键） */
function hookEntryId(scope: CcScope, event: string, idx: number, entry: unknown): string {
  const json = JSON.stringify(entry);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return `${scope}|${event}|${idx}|${(h >>> 0).toString(36)}`;
}

interface HookRow {
  event: string;
  idx: number;
  matcher: string | null;
  command: string;
  id: string;
  raw: unknown;
}

function flattenHooks(map: HooksMap, scope: CcScope): HookRow[] {
  const rows: HookRow[] = [];
  for (const [event, entries] of Object.entries(map)) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, idx) => {
      rows.push({ event, idx, ...describeEntry(entry), id: hookEntryId(scope, event, idx, entry), raw: entry });
    });
  }
  return rows;
}

/** 条目的展示字段（matcher / 命令串）：现表行与停用暂存条目共用同一套渲染 */
function describeEntry(entry: unknown): { matcher: string | null; command: string } {
  const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
  const hs = Array.isArray(e.hooks) ? e.hooks : [];
  const commands = hs
    .map((h) => (h && typeof h === "object" ? String((h as Record<string, unknown>).command ?? "") : ""))
    .filter(Boolean);
  return {
    matcher: typeof e.matcher === "string" && e.matcher !== "" ? e.matcher : null,
    command: commands.join(" && ") || "（空命令）",
  };
}

/** 条目是否挂了多条命令（编辑表单只替换第一条，需要提示） */
function editingMultiCommand(entry: unknown): boolean {
  const hs = entry && typeof entry === "object" && Array.isArray((entry as Record<string, unknown>).hooks)
    ? (entry as Record<string, unknown>).hooks as unknown[]
    : [];
  return hs.length > 1;
}

function HookEditForm({
  initial,
  extraHint,
  onSave,
  onCancel,
}: {
  initial: { event: string; matcher: string; command: string } | null;
  extraHint?: string | null;
  onSave: (v: { event: string; matcher: string; command: string }) => void;
  onCancel: () => void;
}) {
  const [event, setEvent] = useState(initial?.event ?? "PreToolUse");
  const [matcher, setMatcher] = useState(initial?.matcher ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  return (
    <div className="cc-form">
      <div className="cc-form-row">
        <label>事件</label>
        <select value={event} onChange={(e) => setEvent(e.target.value)}>
          {HOOK_EVENTS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>
      <div className="cc-form-row">
        <label>matcher</label>
        <input className="cc-input mono" placeholder="工具名匹配，如 Bash；留空 = 全部" value={matcher} onChange={(e) => setMatcher(e.target.value)} />
      </div>
      <div className="cc-form-row">
        <label>命令</label>
        <input className="cc-input mono" placeholder="要执行的 shell 命令" value={command} onChange={(e) => setCommand(e.target.value)} />
      </div>
      {extraHint && <Hint>{extraHint}</Hint>}
      <div className="cc-form-acts">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onSave({ event, matcher: matcher.trim(), command: command.trim() })}>
          保存
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
];

export function HooksPage({ scope, projectPath, onToast }: { scope: CcScope; projectPath: string | null; onToast?: (m: string) => void }) {
  const { data, error, loading, reload } = useAsync<CcHooksRead>(
    () => api.ccHooksRead(projectPath ?? undefined),
    [projectPath],
  );
  const [editing, setEditing] = useState<HookRow | "new" | null>(null);

  // scope/projectPath 切换必须清编辑态：editing 里攥着旧 scope 的 idx 与条目，
  // 不清的话保存会把旧 scope 的下标套到新 scope 的表上，改错/删错条目
  useEffect(() => {
    setEditing(null);
  }, [scope, projectPath]);

  const hooks: HooksMap | null = useMemo(() => {
    if (!data) return null;
    return scope === "user" ? data.user : data.project ?? {};
  }, [data, scope]);
  // 停用暂存（带内容）：停用时条目已从 settings.json 移出，内容只存在 ccstate——
  // 「已停用」区必须渲染这份列表，从现表 rows 反推永远为空（结构性 bug）
  const disabledEntries = useMemo(
    () => (data?.disabled ?? []).filter((d) => d.scope === scope),
    [data, scope],
  );

  if (error || loading) return <LoadOrError loading={loading} error={error}>{null}</LoadOrError>;
  if (scope === "project" && !projectPath) return <Hint>{PROJECT_NEEDED}</Hint>;
  if (!data || !hooks) return null;

  const rows = flattenHooks(hooks, scope);
  const disabledIds = new Set(disabledEntries.map((d) => d.id));

  const persist = async (map: HooksMap, disabledNext: DisabledHookEntry[]) => {
    try {
      // 契约口径：disabled 是**全局**停用条目全集（ccstate 整份写回）。这里只管
      // 当前 scope 的那份，其他 scope 的暂存条目必须原样带上——被停用条目已从
      // settings.json 移出，ccstate 是其唯一内容副本，漏带 = 抹掉别的 scope 的暂存
      const global = [...(data?.disabled ?? []).filter((d) => d.scope !== scope), ...disabledNext];
      await api.ccHooksWrite(scope, map, global, projectPath ?? undefined);
      reload();
    } catch (e) {
      onToast?.(`保存 Hooks 失败：${String(e)}`);
      reload();
    }
  };

  /** 停用 = 从表移出、完整条目进停用暂存（ccstate.json 持久，重启不复活） */
  const disable = (row: HookRow) => {
    const map: HooksMap = { ...hooks };
    map[row.event] = (map[row.event] ?? []).filter((_, i) => i !== row.idx);
    if ((map[row.event] ?? []).length === 0) delete map[row.event];
    const next = [...disabledEntries.filter((d) => d.id !== row.id), { id: row.id, scope, event: row.event, entry: row.raw }];
    void persist(map, next);
  };
  /** 启用 = 停用暂存里的原条目移回表（内容存在 ccstate，跨会话都能还原） */
  const enable = (d: DisabledHookEntry) => {
    const next = disabledEntries.filter((x) => x.id !== d.id);
    const map: HooksMap = { ...hooks, [d.event]: [...(hooks[d.event] ?? []), d.entry] };
    void persist(map, next);
  };
  const remove = (row: HookRow) => {
    if (!confirm(`删除 ${row.event} 的这条 Hook？命令：${row.command}`)) return;
    const map: HooksMap = { ...hooks };
    map[row.event] = (map[row.event] ?? []).filter((_, i) => i !== row.idx);
    if ((map[row.event] ?? []).length === 0) delete map[row.event];
    void persist(map, disabledEntries.filter((d) => d.id !== row.id));
  };

  return (
    <>
      <WarnBanner>
        Hooks 在每次工具调用 / 会话事件时执行任意命令，写坏影响面大：保存有结构校验兜底，改动对新会话生效。
      </WarnBanner>

      {editing === "new" && (
        <HookEditForm
          initial={null}
          onCancel={() => setEditing(null)}
          onSave={({ event, matcher, command }) => {
            setEditing(null);
            if (!command) return;
            const entry: Record<string, unknown> = { hooks: [{ type: "command", command }] };
            if (matcher) entry.matcher = matcher;
            const map: HooksMap = { ...hooks, [event]: [...(hooks[event] ?? []), entry] };
            void persist(map, disabledEntries);
          }}
        />
      )}
      {editing && editing !== "new" && (
        <HookEditForm
          initial={{ event: editing.event, matcher: editing.matcher ?? "", command: editing.command }}
          extraHint={editingMultiCommand(editing.raw) ? "该条目含多条命令，保存只替换第一条；其余命令原样保留（整串调整请走 Claude Code 的 /hooks）" : null}
          onCancel={() => setEditing(null)}
          onSave={({ event, matcher, command }) => {
            const target = editing as HookRow;
            setEditing(null);
            if (!command) return;
            // 克隆原条目只动 matcher 与第一条命令——条目里的 timeout 等扩展字段原样保留
            const raw = { ...(target.raw as Record<string, unknown>) };
            if (matcher) raw.matcher = matcher;
            else delete raw.matcher;
            const hs = Array.isArray(raw.hooks) ? [...(raw.hooks as Record<string, unknown>[])] : [];
            if (hs.length === 0) hs.push({ type: "command" });
            hs[0] = { ...hs[0], command };
            raw.hooks = hs;
            const map: HooksMap = { ...hooks };
            if (event === target.event) {
              map[event] = (map[event] ?? []).map((v, i) => (i === target.idx ? raw : v));
            } else {
              map[target.event] = (map[target.event] ?? []).filter((_, i) => i !== target.idx);
              if ((map[target.event] ?? []).length === 0) delete map[target.event];
              map[event] = [...(map[event] ?? []), raw];
            }
            void persist(map, disabledEntries);
          }}
        />
      )}

      <H3
        right={
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing("new")}>
            新增 Hook
          </button>
        }
      >
        已启用
      </H3>
      {rows.filter((r) => !disabledIds.has(r.id)).length === 0 ? (
        <EmptyState title="当前 scope 还没有启用的 Hook" desc="配置后可在工具调用前后 / 会话生命周期里自动执行命令" />
      ) : (
        rows
          .filter((r) => !disabledIds.has(r.id))
          .map((r) => (
            <Card
              key={r.id}
              title={
                <>
                  <Badge kind={HOOK_EVENTS.includes(r.event) ? "acc" : "mut"}>{r.event}</Badge>
                  {r.matcher ? <span className="mono cc-chip-inline">{r.matcher}</span> : <span className="cc-hint">全部工具</span>}
                </>
              }
              sub={<span className="mono">{r.command}</span>}
              ops={
                <>
                  <Toggle on title="停用（暂存，可再启用）" onClick={() => disable(r)} />
                  <button type="button" className="icon-btn icon-btn-sm" title="编辑" onClick={() => setEditing(r)}>
                    <PencilIcon size={11} />
                  </button>
                  <button type="button" className="icon-btn icon-btn-sm cc-danger" title="删除" onClick={() => remove(r)}>
                    <XIcon size={11} />
                  </button>
                </>
              }
            />
          ))
      )}

      <H3>已停用（暂存）</H3>
      {disabledEntries.length === 0 ? (
        <Hint>没有停用中的 Hook。停用不会删除配置，随时可再启用。</Hint>
      ) : (
        disabledEntries.map((d) => {
          const r = describeEntry(d.entry);
          return (
            <Card
              key={d.id}
              faded
              title={
                <>
                  <Badge kind="mut">{d.event}</Badge>
                  {r.matcher ? <span className="mono cc-chip-inline">{r.matcher}</span> : <span className="cc-hint">全部工具</span>}
                </>
              }
              sub={<span className="mono">{r.command}</span>}
              ops={
                <button type="button" className="btn btn-sm" onClick={() => enable(d)}>
                  启用
                </button>
              }
            />
          );
        })
      )}

      <EffectiveHint />
    </>
  );
}

// ================= CLAUDE.md =================

export function ClaudeMdPage({ scope, projectPath, onToast }: { scope: AssetScope; projectPath: string | null; onToast?: (m: string) => void }) {
  const { data, error, loading, reload } = useAsync<ClaudeMdView>(
    () => api.ccClaudeMdRead(scope, projectPath ?? undefined),
    [scope, projectPath],
  );
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setText(data.content);
  }, [data]);

  if (error) return <div className="cc-error">加载失败：{error}</div>;
  if (loading || !data || text === null) return <div className="cc-hint">加载中…</div>;

  const save = async () => {
    setSaving(true);
    try {
      await api.ccClaudeMdWrite(scope, text, projectPath ?? undefined);
      reload(); // 静默刷新（拿磁盘实况 + .bak 落定），编辑器不卸载
    } catch (e) {
      onToast?.(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="cc-editor-head">
        <span className="mono cc-hint">{data.path}{data.missing ? " · 尚未创建，保存即创建" : ""}</span>
        <button type="button" className="btn btn-sm btn-primary" disabled={saving || text === data.content} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
      {data.imports.length > 0 && (
        <div className="cc-imports">
          {data.imports.map((im) => (
            <span key={im} className="cc-chip">
              <span className="mono">@{im}</span>
            </span>
          ))}
          <span className="cc-hint">以上 @import 会被 CLI 合并进上下文</span>
        </div>
      )}
      <textarea className="cc-editor" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <EffectiveHint />
    </>
  );
}

// ================= 磁盘占用 =================

/** 磁盘桶的展示名（磁盘页与健康检查弹窗共用一套，勿各写一份） */
export const DISK_LABELS: Record<string, string> = {
  sessions: "会话数据 projects",
  "file-history": "检查点快照 file-history",
  "plugin-cache": "插件缓存 plugins/cache",
  marketplaces: "marketplace 克隆",
  "paste-cache": "粘贴缓存 paste-cache",
  plans: "计划文档 plans",
  "history-jsonl": "提示词历史 history.jsonl",
  "cc-assets-trash": "扩展资源回收站",
  other: "其余数据",
};

export function DiskPage({ onOpenTrash }: { onOpenTrash: () => void }) {
  const { data, error, loading } = useAsync<DiskUsage>(() => api.ccDiskUsage(), []);
  if (error) return <div className="cc-error">统计失败：{error}</div>;
  if (loading || !data) return <div className="cc-hint">统计中…（首次可能要几秒）</div>;

  return (
    <>
      <div className="cc-disk-total">
        <span className="cc-disk-num">{fmtBytes(data.total)}</span>
        <span className="cc-hint">~/.claude 数据目录 + 扩展资源回收站</span>
      </div>
      {data.buckets.map((b) => {
        const pct = data.total > 0 ? Math.max((b.size / data.total) * 100, b.size > 0 ? 0.6 : 0) : 0;
        return (
          <div key={b.name} className="cc-disk-row">
            <div className="cc-disk-l1">
              <span>{DISK_LABELS[b.name] ?? b.name}</span>
              <span className="mono cc-disk-size">{fmtBytes(b.size)}</span>
            </div>
            <div className="cc-disk-bar">
              <div className="cc-disk-fill" style={{ width: `${pct}%` }} />
            </div>
            {b.note && (
              <div className="cc-disk-l2">
                <span className="cc-hint">{b.note}</span>
                {b.name === "sessions" && (
                  <button type="button" className="btn btn-sm" onClick={onOpenTrash}>
                    查看回收站
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <Hint>统计缓存 10 分钟；带清理动作的分桶在后续版本逐个开放。</Hint>
    </>
  );
}
