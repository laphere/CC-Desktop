// 设置中心「扩展资源」域页面：插件 / MCP 服务器 / 技能 / 子代理 / 命令。
// 插件页 Phase 1 只读安装状态 + 启停；MCP 用 JSON 表单（与供应商表单同一
// 「JSON 文本为唯一事实来源」的约定）；文本资源（技能/子代理/命令）为
// 列表 + 点开编辑 + 删除进回收站。
import { useEffect, useState } from "react";
import { PuzzleIcon, WandIcon, BotIcon, TerminalIcon, PlugIcon, PencilIcon, XIcon } from "../Icons";
import { api } from "../../lib/api";
import type {
  AssetScope,
  AssetView,
  McpListView,
  McpScope,
  McpServerView,
  PluginListView,
} from "../../../electron/ipc-contract";
import {
  Badge,
  Card,
  EffectiveHint,
  EmptyState,
  H3,
  Hint,
  LoadOrError,
  Toggle,
  useAsync,
} from "./shared";

// ================= 插件 =================

export function PluginsPage({ onToast }: { onToast?: (m: string) => void }) {
  const { data, error, loading, reload } = useAsync<PluginListView>(() => api.ccPluginList(), []);
  if (error || loading) return <LoadOrError loading={loading} error={error}>{null}</LoadOrError>;
  if (!data) return null;

  const toggle = async (id: string, enabled: boolean) => {
    try {
      await api.ccPluginToggle(id, enabled);
      reload();
    } catch (e) {
      onToast?.(`切换插件启停失败：${String(e)}`);
      reload();
    }
  };

  return (
    <>
      <H3 right={<span className="cc-hint">安装 / 更新 / 卸载在后续版本提供（走 claude plugin 命令）</span>}>
        已安装插件
      </H3>
      {data.plugins.length === 0 && (
        <EmptyState title="还没有已安装的插件" desc="安装走 claude plugin install（后续版本接入）" />
      )}
      {data.plugins.map((p) => (
        <Card
          key={p.id}
          icon={<PuzzleIcon size={14} />}
          title={
            <>
              {p.name}
              <Badge kind="mut">@{p.marketplace || "—"}</Badge>
              {p.installed && p.version && <span className="cc-hint">v{p.version}</span>}
              {!p.installed && <Badge kind="star">内置</Badge>}
              {p.installed && !p.installPathExists && <Badge kind="danger">目录缺失</Badge>}
              <Badge kind={p.enabled ? "ok" : "mut"}>{p.enabled ? "已启用" : "已停用"}</Badge>
            </>
          }
          sub={p.installPath ?? "无安装记录（官方内置 marketplace 按需装载）"}
          ops={
            <>
              <Toggle on={p.enabled} onClick={() => toggle(p.id, !p.enabled)} title="启用/停用（写 settings.json 的 enabledPlugins）" />
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                disabled
                title="详情（后续版本：claude plugin details）"
              >
                <PlugIcon size={11} />
              </button>
            </>
          }
        />
      ))}

      <H3>Marketplace</H3>
      {data.marketplaces.length === 0 ? (
        <Hint>还没有配置任何 marketplace。</Hint>
      ) : (
        data.marketplaces.map((m) => (
          <Card
            key={m.name}
            title={m.name}
            sub={m.repo ? `${m.sourceType ?? "source"}:${m.repo}` : m.installLocation ?? "—"}
            ops={
              <button
                type="button"
                className="btn btn-sm"
                disabled
                title="更新 marketplace（后续版本：claude plugin marketplace update）"
              >
                更新
              </button>
            }
          />
        ))
      )}
      <EffectiveHint />
    </>
  );
}

// ================= MCP 服务器 =================

const MCP_TEMPLATES: Record<string, string> = {
  stdio: JSON.stringify({ type: "stdio", command: "npx -y some-mcp-server", args: [], env: {} }, null, 2),
  http: JSON.stringify({ type: "http", url: "https://example.com/mcp", headers: {} }, null, 2),
  sse: JSON.stringify({ type: "sse", url: "https://example.com/sse" }, null, 2),
};

function configSummary(cfg: Record<string, unknown>): string {
  const type = typeof cfg.type === "string" ? cfg.type : "stdio";
  if (type === "stdio") {
    const args = Array.isArray(cfg.args) ? cfg.args.map(String).join(" ") : "";
    return `stdio · ${String(cfg.command ?? "?")}${args ? " " + args : ""}`;
  }
  return `${type} · ${String(cfg.url ?? "?")}`;
}

function McpForm({
  initialName,
  initialJson,
  onDone,
  onCancel,
  scope,
  projectPath,
  onToast,
}: {
  initialName: string;
  initialJson: string;
  onDone: () => void;
  onCancel: () => void;
  scope: McpScope;
  projectPath: string | null;
  onToast?: (m: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [json, setJson] = useState(initialJson);
  const save = async () => {
    let config: unknown;
    try {
      config = JSON.parse(json);
    } catch {
      onToast?.("配置不是合法 JSON");
      return;
    }
    try {
      await api.ccMcpSave(scope, name.trim(), config, projectPath ?? undefined);
      onDone();
    } catch (e) {
      onToast?.(String(e));
    }
  };
  return (
    <div className="cc-form">
      <div className="cc-form-row">
        <label>名称</label>
        <input className="cc-input mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 codegraph" />
      </div>
      <div className="cc-form-row cc-form-col">
        <label>
          配置（JSON）
          {(["stdio", "http", "sse"] as const).map((t) => (
            <button key={t} type="button" className="linkish" style={{ marginLeft: 8 }} onClick={() => setJson(MCP_TEMPLATES[t])}>
              {t} 模板
            </button>
          ))}
        </label>
        <textarea className="cc-editor cc-editor-short mono" spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} />
      </div>
      <div className="cc-form-acts">
        <button type="button" className="btn btn-sm btn-primary" onClick={save}>
          保存
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

function McpRow({
  v,
  scope,
  projectPath,
  onChanged,
  onToast,
}: {
  v: McpServerView;
  scope: McpScope;
  projectPath: string | null;
  onChanged: () => void;
  onToast?: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const approved = v.approved;
  const del = async () => {
    if (!confirm(`删除 MCP 服务器「${v.name}」（${scope} scope）？`)) return;
    try {
      await api.ccMcpDelete(scope, v.name, projectPath ?? undefined);
      onChanged();
    } catch (e) {
      onToast?.(String(e));
    }
  };
  const approve = async (ok: boolean) => {
    if (!projectPath) return;
    try {
      await api.ccMcpApprove(projectPath, v.name, ok);
      onChanged();
    } catch (e) {
      onToast?.(String(e));
    }
  };

  if (editing) {
    return (
      <div className="cc-card cc-card-open">
        <McpForm
          scope={scope}
          projectPath={projectPath}
          initialName={v.name}
          initialJson={JSON.stringify(v.config, null, 2)}
          onToast={onToast}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <Card
      icon={<PlugIcon size={14} />}
      title={
        <>
          {v.name}
          {scope === "project" ? <Badge kind="acc">共享 .mcp.json</Badge> : scope === "local" ? <Badge kind="mut">私有</Badge> : <Badge kind="mut">用户级</Badge>}
          {scope === "project" &&
            (approved === true ? (
              <Badge kind="ok">已批准</Badge>
            ) : approved === false ? (
              <Badge kind="danger">已拒绝</Badge>
            ) : (
              <Badge kind="star">待审批</Badge>
            ))}
        </>
      }
      sub={<span className="mono">{configSummary(v.config)}</span>}
      ops={
        <>
          {scope === "project" && approved === null && projectPath && (
            <button type="button" className="icon-btn icon-btn-sm cc-danger" title="拒绝（写 disabledMcpjsonServers）" onClick={() => approve(false)}>
              <XIcon size={11} />
            </button>
          )}
          {scope === "project" && approved !== true && projectPath && (
            <button type="button" className="btn btn-sm" onClick={() => approve(true)}>
              批准
            </button>
          )}
          <button type="button" className="icon-btn icon-btn-sm" title="编辑（JSON）" onClick={() => setEditing(true)}>
            <PencilIcon size={11} />
          </button>
          <button type="button" className="icon-btn icon-btn-sm cc-danger" title="删除" onClick={del}>
            <XIcon size={11} />
          </button>
        </>
      }
    />
  );
}

export function McpPage({ scope, projectPath, onToast }: { scope: "user" | "project"; projectPath: string | null; onToast?: (m: string) => void }) {
  const { data, error, loading, reload } = useAsync<McpListView>(
    () => api.ccMcpList(projectPath ?? undefined),
    [projectPath],
  );
  const [adding, setAdding] = useState<McpScope | null>(null);

  if (error || loading) return <LoadOrError loading={loading} error={error}>{null}</LoadOrError>;
  if (!data) return null;

  const changed = () => reload();
  const withProject = scope === "project" && !!projectPath;

  return (
    <>
      <H3 right={
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(scope)}>
          添加服务器
        </button>
      }>
        {scope === "user" ? "用户级（~/.claude.json，全项目生效）" : "本项目（<项目>/.mcp.json，随仓库共享）"}
      </H3>
      {scope === "project" && <Hint>此文件在项目根目录，注意 git 提交范围；是否连接由下方审批态决定。</Hint>}
      {adding === scope && (
        <div className="cc-card cc-card-open">
          <McpForm
            scope={scope}
            projectPath={projectPath}
            initialName=""
            initialJson={MCP_TEMPLATES.stdio}
            onToast={onToast}
            onDone={() => {
              setAdding(null);
              changed();
            }}
            onCancel={() => setAdding(null)}
          />
        </div>
      )}
      {(scope === "user" ? data.user : data.project).length === 0 && adding !== scope ? (
        <EmptyState title="暂无服务器" desc={scope === "user" ? "用户级 MCP 对所有项目的会话生效" : "共享服务器写在项目根 .mcp.json"} />
      ) : (
        (scope === "user" ? data.user : data.project).map((v) => (
          <McpRow key={v.name} v={v} scope={scope} projectPath={projectPath} onChanged={changed} onToast={onToast} />
        ))
      )}

      {withProject && (
        <>
          <H3 right={
            <button type="button" className="btn btn-sm" onClick={() => setAdding("local")}>
              添加
            </button>
          }>
            本项目私有（仅本机本项目可见）
          </H3>
          {adding === "local" && (
            <div className="cc-card cc-card-open">
              <McpForm
                scope="local"
                projectPath={projectPath}
                initialName=""
                initialJson={MCP_TEMPLATES.stdio}
                onToast={onToast}
                onDone={() => {
                  setAdding(null);
                  changed();
                }}
                onCancel={() => setAdding(null)}
              />
            </div>
          )}
          {data.local.length === 0 && adding !== "local" ? (
            <Hint>私有 scope 落在 ~/.claude.json 的本项目条目里，只在本机本项目生效。</Hint>
          ) : (
            data.local.map((v) => <McpRow key={v.name} v={v} scope="local" projectPath={projectPath} onChanged={changed} onToast={onToast} />)
          )}
        </>
      )}

      <EffectiveHint />
    </>
  );
}

// ================= 技能 / 子代理 / 命令 =================

const SKILL_TEMPLATE = `---
name: 新技能
description: 一句话说明这个技能做什么、什么时候该触发（触发判断就看它）
---

# 新技能

（正文：给模型的操作指引）`;

function assetTemplate(kind: "agent" | "command"): string {
  if (kind === "agent") {
    return `---
name: my-agent
description: 一句话说明这个子代理做什么（Task 调度就看它）
tools: 
model: inherit
---

你是……（子代理的系统提示）`;
  }
  return `描述这条命令做什么。

$ARGUMENTS`;
}

function AssetEditor({
  path,
  value,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  path: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="cc-card-open">
      <div className="cc-editor-head">
        <span className="mono cc-hint">{path}</span>
        <span className="cc-form-acts">
          <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={onSave}>
            {saving ? "保存中…" : "保存"}
          </button>
          <button type="button" className="btn btn-sm" onClick={onCancel}>
            取消
          </button>
        </span>
      </div>
      <textarea className="cc-editor" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TextAssetPage({
  kind,
  scope,
  projectPath,
  onToast,
}: {
  kind: "skill" | "agent" | "command";
  scope: AssetScope;
  projectPath: string | null;
  onToast?: (m: string) => void;
}) {
  const { data, error, loading, reload } = useAsync<AssetView[]>(
    () => api.ccAssetsList(kind, scope, projectPath ?? undefined),
    [kind, scope, projectPath],
  );
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // scope/projectPath 切换必须清编辑态：openPath/draft 是另一个 scope 的内容，
  // 不清的话「保存」会把旧 scope 的文件写到新 scope（new: 前缀下直接跨 scope 落盘）
  useEffect(() => {
    setCreating(false);
    setNewName("");
    setOpenPath(null);
    setDraft("");
  }, [scope, projectPath]);

  if (error || loading) return <LoadOrError loading={loading} error={error}>{null}</LoadOrError>;

  const list = data ?? [];
  const icon = kind === "skill" ? <WandIcon size={14} /> : kind === "agent" ? <BotIcon size={14} /> : <TerminalIcon size={14} />;
  const kindLabel = kind === "skill" ? "技能" : kind === "agent" ? "子代理" : "命令";
  const rootLabel =
    scope === "user"
      ? kind === "skill"
        ? "~/.claude/skills/"
        : `~/.claude/${kind}s/`
      : kind === "skill"
        ? "<项目>/.claude/skills/"
        : `<项目>/.claude/${kind}s/`;

  const openNew = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(false);
    setNewName("");
    // 直接进入编辑态，保存时才落盘
    setOpenPath(`new:${name}`);
    setDraft(kind === "skill" ? SKILL_TEMPLATE : assetTemplate(kind === "agent" ? "agent" : "command"));
  };

  const saveNew = async () => {
    const name = (openPath ?? "").replace(/^new:/, "");
    setSaving(true);
    try {
      const p = await api.ccAssetWrite(kind, scope, name, draft, projectPath ?? undefined);
      setOpenPath(p);
      reload();
    } catch (e) {
      onToast?.(String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveExisting = async () => {
    if (!openPath) return;
    setSaving(true);
    try {
      await api.ccAssetWrite(kind, scope, viewNameOf(list, openPath), draft, projectPath ?? undefined);
      reload();
    } catch (e) {
      onToast?.(String(e));
    } finally {
      setSaving(false);
    }
  };

  const del = async (v: AssetView) => {
    if (!confirm(`删除${kindLabel}「${v.name}」？将移入 app 回收站（trash/cc-assets）。`)) return;
    try {
      await api.ccAssetDelete(kind, scope, v.name, projectPath ?? undefined);
      if (openPath === v.path) setOpenPath(null);
      reload();
    } catch (e) {
      onToast?.(String(e));
    }
  };

  const open = async (v: AssetView) => {
    if (openPath === v.path) {
      setOpenPath(null);
      return;
    }
    try {
      const r = await api.ccAssetRead(kind, scope, v.name, projectPath ?? undefined);
      setOpenPath(r.path);
      setDraft(r.content);
    } catch (e) {
      onToast?.(String(e));
    }
  };

  return (
    <>
      <H3
        right={
          !creating && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
              新建{kindLabel}
            </button>
          )
        }
      >
        {`${rootLabel}（${list.length}）`}
      </H3>

      {creating && (
        <div className="cc-form cc-card-open">
          <div className="cc-form-row">
            <label>名字</label>
            <input
              className="cc-input mono"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") openNew();
              }}
              placeholder={kind === "skill" ? "单段目录名，如 my-skill" : kind === "command" ? "可嵌套，如 frontend/ship" : "my-agent"}
            />
            <button type="button" className="btn btn-sm" onClick={openNew}>
              下一步
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setCreating(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {list.length === 0 && !creating && openPath === null ? (
        <EmptyState
          icon={icon}
          title={`当前 scope 还没有${kindLabel}`}
          desc={
            kind === "skill"
              ? "技能 = 目录 + SKILL.md；插件自带的技能归「插件」页管"
              : kind === "agent"
                ? "子代理 = 带 frontmatter 的 Markdown（name/description/tools/model）"
                : "命令 = Markdown 提示词模板，支持 $ARGUMENTS 传参；插件命令归「插件」页"
          }
        />
      ) : (
        list.map((v) => (
          <Card
            key={v.name}
            icon={icon}
            title={
              <>
                {v.name}
                {v.description ? null : <Badge kind="mut">无描述</Badge>}
              </>
            }
            sub={v.description ?? v.path}
            ops={
              <>
                <button type="button" className="btn btn-sm" onClick={() => open(v)}>
                  {openPath === v.path ? "收起" : "编辑"}
                </button>
                <button type="button" className="icon-btn icon-btn-sm cc-danger" title="删除（进回收站）" onClick={() => del(v)}>
                  <XIcon size={11} />
                </button>
              </>
            }
          />
        ))
      )}

      {openPath?.startsWith("new:") && (
        <AssetEditor
          path={`${rootLabel}${openPath.slice(4)}${kind === "skill" ? "/SKILL.md" : ".md"}`}
          value={draft}
          onChange={setDraft}
          onSave={saveNew}
          onCancel={() => setOpenPath(null)}
          saving={saving}
        />
      )}
      {openPath && !openPath.startsWith("new:") && (
        <AssetEditor
          path={openPath}
          value={draft}
          onChange={setDraft}
          onSave={saveExisting}
          onCancel={() => setOpenPath(null)}
          saving={saving}
        />
      )}

      <EffectiveHint />
    </>
  );
}

/** 编辑已有条目时从路径反查名字（ccAssetWrite 的 name 参数要的是列表名） */
function viewNameOf(list: AssetView[], path: string): string {
  return list.find((v) => v.path === path)?.name ?? path;
}

export function SkillsPage({ scope, projectPath, onToast }: { scope: AssetScope; projectPath: string | null; onToast?: (m: string) => void }) {
  return <TextAssetPage kind="skill" scope={scope} projectPath={projectPath} onToast={onToast} />;
}
export function AgentsPage({ scope, projectPath, onToast }: { scope: AssetScope; projectPath: string | null; onToast?: (m: string) => void }) {
  return <TextAssetPage kind="agent" scope={scope} projectPath={projectPath} onToast={onToast} />;
}
export function CommandsPage({ scope, projectPath, onToast }: { scope: AssetScope; projectPath: string | null; onToast?: (m: string) => void }) {
  return <TextAssetPage kind="command" scope={scope} projectPath={projectPath} onToast={onToast} />;
}
