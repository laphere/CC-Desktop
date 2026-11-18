// 设置中心「扩展资源」域页面：插件 / MCP 服务器 / 技能 / 子代理 / 命令。
// 插件页 Phase 1 只读安装状态 + 启停；MCP 用 JSON 表单（与供应商表单同一
// 「JSON 文本为唯一事实来源」的约定）；文本资源（技能/子代理/命令）为
// 列表 + 点开编辑 + 删除进回收站。
import { useEffect, useState } from "react";
import {
  PuzzleIcon,
  WandIcon,
  BotIcon,
  TerminalIcon,
  PlugIcon,
  PencilIcon,
  TrashIcon,
  XIcon,
} from "../Icons";
import { animateModalClose } from "../Modal";
import ConfirmDialog from "../ConfirmDialog";
import { api } from "../../lib/api";
import type {
  AssetScope,
  AssetView,
  CliOutcome,
  McpCheckResult,
  McpListView,
  McpScope,
  McpServerView,
  PluginDetails,
  PluginListView,
  PluginView,
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

/** CLI 回执 message 常带多行（marketplace update 的日志），toast 是单行短句容器，
 *  展示前折平；完整原文在后端 `CliOutcome.raw` 里。 */
function oneLine(s: string | null): string | null {
  if (s === null) return null;
  const folded = s.replace(/\s*\r?\n\s*/g, " ").trim();
  return folded || null;
}

/** 插件详情展开区（组件清单 + projected token cost；解析不出时至少给出原始输出） */
function PluginDetailBody({ detail, loading }: { detail: PluginDetails | null; loading: boolean }) {
  if (loading) return <div className="cc-plugin-detail"><span className="cc-hint">读取中…</span></div>;
  if (!detail) return null;
  return (
    <div className="cc-plugin-detail">
      {detail.error && <div className="cc-error">{detail.error}</div>}
      {(detail.name || detail.version) && (
        <div className="cc-plugin-detail-head">
          <b>{detail.name ?? "（未解析）"}</b>
          {detail.version && <span className="cc-hint">v{detail.version}</span>}
        </div>
      )}
      {detail.description && <div className="cc-plugin-detail-desc">{detail.description}</div>}
      {detail.source && <div className="cc-hint">来源：{detail.source}</div>}
      {detail.components.length > 0 && (
        <div className="cc-plugin-detail-sec">
          <span className="cc-plugin-detail-label">组件清单</span>
          <span className="cc-plugin-detail-list">
            {detail.components.map((c) => `${c.label} ${c.count}`).join(" · ")}
          </span>
        </div>
      )}
      {(detail.tokenAlwaysOn || detail.tokenLines.length > 0) && (
        <div className="cc-plugin-detail-sec">
          <span className="cc-plugin-detail-label">Projected token cost</span>
          {detail.tokenAlwaysOn && <div className="cc-plugin-detail-list">{detail.tokenAlwaysOn}</div>}
          {detail.tokenLines.map((l, i) => (
            <div key={i} className="cc-hint">{l}</div>
          ))}
        </div>
      )}
      {detail.raw && (
        <details className="cc-plugin-detail-raw">
          <summary>原始输出</summary>
          <pre>{detail.raw}</pre>
        </details>
      )}
    </div>
  );
}

export function PluginsPage({ onToast }: { onToast?: (m: string) => void }) {
  const { data, error, loading, reload } = useAsync<PluginListView>(() => api.ccPluginList(), []);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PluginDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // ---- 写操作（卸载 / marketplace 管理）：一律先确认，再走 CLI。
  //  ⚠️ 这些 useState 必须留在 early return 之前（hooks 顺序不能随渲染变化） ----
  const [confirm, setConfirm] = useState<
    | { kind: "uninstall"; plugin: PluginView }
    | { kind: "mkt-remove"; name: string }
    | { kind: "mkt-update"; name: string }
    | null
  >(null);
  const [addingMkt, setAddingMkt] = useState(false);
  const [mktSource, setMktSource] = useState("");
  const [mktBusy, setMktBusy] = useState(false);
  if (error || loading) return <LoadOrError loading={loading} error={error}>{null}</LoadOrError>;
  if (!data) return null;

  /** 展开/收起某插件的详情（再点一次收起；详情失败时后端回 error + raw，不抛） */
  const openDetail = async (p: PluginView) => {
    if (detailId === p.id) {
      setDetailId(null);
      setDetail(null);
      return;
    }
    setDetailId(p.id);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await api.ccPluginDetails(p.id));
    } catch (e) {
      setDetail({
        name: p.id,
        version: null,
        description: null,
        source: null,
        components: [],
        tokenAlwaysOn: null,
        tokenLines: [],
        error: String(e),
        raw: "",
      });
    } finally {
      setDetailLoading(false);
    }
  };

  const toggle = async (id: string, enabled: boolean) => {
    try {
      await api.ccPluginToggle(id, enabled);
      reload();
    } catch (e) {
      onToast?.(`切换插件启停失败：${String(e)}`);
      reload();
    }
  };

  /** 执行确认框里的动作；成功才关框（失败留着让用户看到原因） */
  const runConfirm = async () => {
    if (!confirm) return;
    try {
      let r: CliOutcome;
      if (confirm.kind === "uninstall") r = await api.ccPluginUninstall(confirm.plugin.id);
      else if (confirm.kind === "mkt-remove") r = await api.ccMarketplaceRemove(confirm.name);
      else r = await api.ccMarketplaceUpdate(confirm.name);
      if (r.ok) {
        onToast?.(oneLine(r.message) ?? "完成");
        setConfirm(null);
        reload();
      } else {
        onToast?.(`${r.failureCode ? `[${r.failureCode}] ` : ""}${oneLine(r.message) ?? "操作失败"}`);
      }
    } catch (e) {
      onToast?.(`操作失败：${String(e)}`);
    }
  };

  const addMarketplace = async () => {
    const src = mktSource.trim();
    if (!src) return;
    setMktBusy(true);
    try {
      const r = await api.ccMarketplaceAdd(src);
      if (r.ok) {
        onToast?.(oneLine(r.message) ?? "已添加");
        setAddingMkt(false);
        setMktSource("");
        reload();
      } else {
        onToast?.(`${r.failureCode ? `[${r.failureCode}] ` : ""}${oneLine(r.message) ?? "添加失败"}`);
      }
    } catch (e) {
      onToast?.(`添加失败：${String(e)}`);
    } finally {
      setMktBusy(false);
    }
  };


  return (
    <>
      <H3 right={<span className="cc-hint">卸载见插件行；安装 / 更新在后续版本提供（走 claude plugin 命令）</span>}>
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
          children={
            detailId === p.id ? <PluginDetailBody detail={detail} loading={detailLoading} /> : undefined
          }
          ops={
            <>
              <Toggle on={p.enabled} onClick={() => toggle(p.id, !p.enabled)} title="启用/停用（写 settings.json 的 enabledPlugins）" />
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                disabled={detailLoading && detailId === p.id}
                title="详情（claude plugin details：组件清单与 projected token 成本）"
                onClick={() => openDetail(p)}
              >
                <PlugIcon size={11} />
              </button>
              {p.installed && (
                <button
                  type="button"
                  className="icon-btn icon-btn-sm cc-danger"
                  title="卸载（从磁盘删除安装体，CLI 可重装）"
                  onClick={() => setConfirm({ kind: "uninstall", plugin: p })}
                >
                  <TrashIcon size={11} />
                </button>
              )}
            </>
          }
        />
      ))}

      <H3
        right={
          <button
            type="button"
            className="btn btn-sm"
            disabled={mktBusy}
            onClick={() => {
              setAddingMkt((v) => !v);
              setMktSource("");
            }}
          >
            {addingMkt ? "取消添加" : "添加 marketplace"}
          </button>
        }
      >
        Marketplace
      </H3>
      {addingMkt && (
        <div className="cc-form">
          <div className="cc-form-row">
            <label>源</label>
            <input
              className="cc-input mono"
              placeholder="owner/repo、git/https URL 或本地路径"
              value={mktSource}
              onChange={(e) => setMktSource(e.target.value)}
            />
          </div>
          <Hint>添加会拉取外部仓库并写入 settings.json 的 extraKnownMarketplaces，请只用可信来源。</Hint>
          <div className="cc-form-acts">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={mktBusy || !mktSource.trim()}
              onClick={addMarketplace}
            >
              添加
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={mktBusy}
              onClick={() => {
                setAddingMkt(false);
                setMktSource("");
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {data.marketplaces.length === 0 ? (
        <Hint>还没有配置任何 marketplace。</Hint>
      ) : (
        data.marketplaces.map((m) => (
          <Card
            key={m.name}
            title={m.name}
            sub={m.repo ? `${m.sourceType ?? "source"}:${m.repo}` : m.installLocation ?? "—"}
            ops={
              <>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setConfirm({ kind: "mkt-update", name: m.name })}
                  title="更新 marketplace（claude plugin marketplace update，从源重新拉取克隆）"
                >
                  更新
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm cc-danger"
                  onClick={() => setConfirm({ kind: "mkt-remove", name: m.name })}
                  title="移除 marketplace（清声明与启用条目）"
                >
                  <TrashIcon size={11} />
                </button>
              </>
            }
          />
        ))
      )}
      <EffectiveHint />

      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === "uninstall"
              ? "卸载插件"
              : confirm.kind === "mkt-remove"
                ? "移除 marketplace"
                : "更新 marketplace"
          }
          message={
            confirm.kind === "uninstall"
              ? `确定卸载「${confirm.plugin.name}」吗？将从磁盘删除安装体，CLI 可随时重装。`
              : confirm.kind === "mkt-remove"
                ? `确定移除 marketplace「${confirm.name}」吗？会同时删掉 settings 里的声明与该市场的启用条目，需重新添加才能恢复。`
                : `从源重新拉取「${confirm.name}」的本地克隆？本地未推的改动可能被覆盖。`
          }
          okText={confirm.kind === "mkt-update" ? "更新" : confirm.kind === "mkt-remove" ? "移除" : "卸载"}
          danger
          onCancel={() => animateModalClose(() => setConfirm(null))}
          onOk={runConfirm}
        />
      )}
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
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<McpCheckResult | null>(null);
  const approved = v.approved;
  /** 连接测试会真起服务器进程做健康检查（可能几秒），期间禁用按钮 */
  const runCheck = async () => {
    if (checking) return;
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await api.ccMcpCheck(v.name, projectPath ?? undefined));
    } catch (e) {
      setCheck({
        name: v.name,
        status: "连接失败",
        scope: null,
        type: null,
        command: null,
        args: null,
        error: String(e),
        timedOut: false,
        raw: "",
      });
    } finally {
      setChecking(false);
    }
  };
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
      children={
        check && (
          <div className="cc-mcp-check">
            <div className="cc-mcp-check-head">
              <Badge kind={check.status === "已连接" ? "ok" : check.status === "待审批" ? "star" : "danger"}>
                {check.status ?? "未知"}
              </Badge>
              {check.scope && <span className="cc-hint">{check.scope}</span>}
            </div>
            {check.error && <div className="cc-error">{check.error}</div>}
            {(check.type || check.command) && (
              <div className="mono cc-mcp-check-cmd">
                {check.type}
                {check.command ? `: ${check.command}` : ""}
                {check.args ? ` ${check.args}` : ""}
              </div>
            )}
            {check.raw && (
              <details className="cc-mcp-check-raw">
                <summary>原始输出</summary>
                <pre>{check.raw}</pre>
              </details>
            )}
          </div>
        )
      }
      ops={
        <>
          <button
            type="button"
            className="btn btn-sm"
            disabled={checking}
            onClick={runCheck}
            title="用 claude mcp get 做健康检查（会真连服务器）"
          >
            {checking ? "测试中…" : "测试"}
          </button>
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
  notice,
}: {
  path: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  /** 编辑区顶部的一行提示（如链接条目的写透警示）；不传不占位 */
  notice?: string;
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
      {notice && <div className="cc-hint cc-editor-notice">{notice}</div>}
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
    // Windows/macOS 默认文件系统大小写不敏感，同名不同大小写也会落进同一目录
    const dup = list.find((v) => v.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      onToast?.(`已存在同名${kindLabel}「${dup.name}」，请直接编辑`);
      return;
    }
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
                {v.isLink ? <Badge kind="mut">链接</Badge> : null}
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
          notice={
            list.find((v) => v.path === openPath)?.isLink
              ? "此目录是符号链接：保存会写透至链接指向的源目录（如 ~/.agents/skills 的共享技能）"
              : undefined
          }
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
