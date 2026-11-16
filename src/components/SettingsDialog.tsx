// 设置中心（Hub）：左导航多页弹窗。
//
// 「应用」页 = 原设置弹窗的全部内容（自启动 / 默认交互 / 关闭行为，footer 保存）；
// 其余页为 Claude Code 配置与扩展管理（权限规则 / Hooks / 插件 / MCP / 技能 /
// 子代理 / 命令 / CLAUDE.md / 磁盘占用），各页即时落盘、无统一保存钮。
// 项目级管理从项目行右键菜单进入（project prop 非空 = scope 锁定本项目）。
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Modal from "./Modal";
import type { CloseAction } from "../types";
import { api } from "../lib/api";
import {
  SettingsIcon,
  ExternalLinkIcon,
  ShieldIcon,
  WorkflowIcon,
  PuzzleIcon,
  PlugIcon,
  WandIcon,
  BotIcon,
  TerminalIcon,
  FileTextIcon,
  HardDriveIcon,
  LockIcon,
} from "./Icons";
import { ScopeSeg } from "./settings/shared";
import { PermsPage, HooksPage, ClaudeMdPage, DiskPage } from "./settings/pages-config";
import { PluginsPage, McpPage, SkillsPage, AgentsPage, CommandsPage } from "./settings/pages-ext";

export type SettingsPageId =
  | "app"
  | "providers"
  | "perms"
  | "hooks"
  | "plugins"
  | "mcp"
  | "skills"
  | "agents"
  | "commands"
  | "claudemd"
  | "disk";

interface Props {
  closeAction: CloseAction;
  defaultInteraction: "chat" | "terminal";
  /** 非空 = 从项目行右键菜单进入：定位到指定页并把 scope 锁在该项目 */
  initial?: { page?: SettingsPageId; projectPath?: string; projectName?: string } | null;
  onClose: () => void;
  onSave: (action: CloseAction, interaction: "chat" | "terminal") => Promise<void>;
  /** 「供应商」页跳转：打开独立的 ProviderDialog（设置弹窗保持挂在下层） */
  onOpenProviders: () => void;
  /** 磁盘页「查看回收站」：关闭设置、打开回收站弹窗 */
  onOpenTrash: () => void;
  /** cc 页的失败提示（App 的 showToast；原生 alert 阻塞且不可主题化，不用） */
  onToast: (msg: string) => void;
}

const OPTIONS: { value: CloseAction; label: string; desc: string }[] = [
  { value: null, label: "每次询问", desc: "点击关闭时弹出选择：退出程序或最小化到通知栏" },
  { value: "quit", label: "直接退出程序", desc: "点击关闭窗口后立即退出（当前行为）" },
  { value: "minimize", label: "最小化到通知栏", desc: "点击关闭窗口后隐藏到系统托盘，托盘图标可重新打开；通过托盘菜单「退出程序」彻底退出" },
];

const INTERACTIONS: { value: "chat" | "terminal"; label: string; desc: string }[] = [
  { value: "chat", label: "页面对话", desc: "图形界面对话（权限确认 / 方案审批 / 提问都有卡片）" },
  { value: "terminal", label: "内嵌终端", desc: "app 内嵌真 claude 终端（完整 TUI 交互，等价系统终端）" },
];

const PAGE_TITLES: Record<SettingsPageId, string> = {
  app: "应用设置",
  providers: "供应商",
  perms: "权限规则",
  hooks: "Hooks",
  plugins: "插件",
  mcp: "MCP 服务器",
  skills: "技能",
  agents: "子代理",
  commands: "命令",
  claudemd: "CLAUDE.md",
  disk: "磁盘占用",
};

/** 带 scope 切换器的页面（头部渲染 用户级/本项目 分段） */
const SCOPED_PAGES = new Set<SettingsPageId>(["perms", "hooks", "mcp", "skills", "agents", "commands", "claudemd"]);

const NAV: { group: string; items: { id: SettingsPageId; label: string; icon: ReactNode }[] }[] = [
  {
    group: "应用",
    items: [
      { id: "app", label: "应用设置", icon: <SettingsIcon size={14} /> },
      { id: "providers", label: "供应商", icon: <ExternalLinkIcon size={14} /> },
    ],
  },
  {
    group: "CLAUDE CODE 配置",
    items: [
      { id: "perms", label: "权限规则", icon: <ShieldIcon size={14} /> },
      { id: "hooks", label: "Hooks", icon: <WorkflowIcon size={14} /> },
    ],
  },
  {
    group: "扩展资源",
    items: [
      { id: "plugins", label: "插件", icon: <PuzzleIcon size={14} /> },
      { id: "mcp", label: "MCP 服务器", icon: <PlugIcon size={14} /> },
      { id: "skills", label: "技能", icon: <WandIcon size={14} /> },
      { id: "agents", label: "子代理", icon: <BotIcon size={14} /> },
      { id: "commands", label: "命令", icon: <TerminalIcon size={14} /> },
      { id: "claudemd", label: "CLAUDE.md", icon: <FileTextIcon size={14} /> },
    ],
  },
  {
    group: "数据",
    items: [{ id: "disk", label: "磁盘占用", icon: <HardDriveIcon size={14} /> }],
  },
];

// ---------------- 「应用」页（原设置弹窗内容，交互不变） ----------------

/** 选项卡片外壳（单选 / 复选共用）：整块可点，选中态铺强调底色 */
const cardStyle = (active: boolean): CSSProperties => ({
  display: "block",
  padding: "10px 12px",
  marginBottom: 8,
  border: "1px solid var(--border)",
  borderRadius: 8,
  cursor: "pointer",
  background: active ? "var(--accent-soft)" : "transparent",
});

/** 卡片内说明文字：左缩进与控件后的标题对齐（24 = 控件宽 + 8 间距），勿改 */
const cardDescStyle: CSSProperties = {
  fontSize: 12,
  opacity: 0.7,
  marginTop: 4,
  paddingLeft: 24,
};

function AppPage({
  closeAction,
  defaultInteraction,
  onPick,
}: {
  closeAction: CloseAction;
  defaultInteraction: "chat" | "terminal";
  onPick: (action: CloseAction, interaction: "chat" | "terminal") => void;
}) {
  const [value, setValue] = useState<CloseAction>(closeAction);
  const [interaction, setInteraction] = useState<"chat" | "terminal">(defaultInteraction);
  const [autoStart, setAutoStart] = useState(false);
  const [autoSupported, setAutoSupported] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const [supported, enabled] = await Promise.all([api.isAutostartSupported(), api.autostartEnabled()]);
      if (disposed) return;
      setAutoSupported(supported);
      setAutoStart(enabled);
    })().catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  const toggleAutoStart = async (on: boolean) => {
    setAutoBusy(true);
    try {
      if (on) await api.autostartTurnOn();
      else await api.autostartTurnOff();
      setAutoStart(on);
    } catch {
      setAutoStart(!on); // 失败回滚显示
    } finally {
      setAutoBusy(false);
    }
  };

  // 选择即上报（footer 的保存只负责落盘，state 归本组件管）
  useEffect(() => {
    onPick(value, interaction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, interaction]);

  return (
    <>
      {autoSupported && (
        <section className="cc-app-section">
          <div className="cc-h3"><span>开机自启动</span></div>
          <label style={{ ...cardStyle(autoStart), display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={autoStart} disabled={autoBusy} onChange={(e) => toggleAutoStart(e.target.checked)} />
            <span style={{ fontWeight: 500 }}>登录系统后自动启动 CC Desktop</span>
            <span style={{ fontSize: 12, opacity: 0.7, marginLeft: "auto" }}>
              {autoBusy ? "正在设置…" : "开启后，开机登录时自动在后台运行本应用"}
            </span>
          </label>
        </section>
      )}

      <div className="cc-app-grid">
        <section>
          <div className="cc-h3"><span>新开会话的默认方式</span></div>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
            决定「项目行 +」用哪种方式新建会话，也决定只读页上「继续对话」用哪种方式接着聊。点击会话行固定打开只读查看（不起进程）；在系统终端里继续那条固定在右键菜单里，不受此设置影响。两种标签页可同时打开，切换此设置不影响已打开的标签页
          </div>
          {INTERACTIONS.map((o) => (
            <label key={o.value} style={cardStyle(interaction === o.value)}>
              <input type="radio" name="defaultInteraction" checked={interaction === o.value} onChange={() => setInteraction(o.value)} style={{ marginRight: 8 }} />
              <span style={{ fontWeight: 500 }}>{o.label}</span>
              <div style={cardDescStyle}>{o.desc}</div>
            </label>
          ))}
        </section>

        <section>
          <div className="cc-h3"><span>关闭窗口时的行为</span></div>
          {OPTIONS.map((o) => (
            <label key={String(o.value)} style={cardStyle(value === o.value)}>
              <input type="radio" name="closeAction" checked={value === o.value} onChange={() => setValue(o.value)} style={{ marginRight: 8 }} />
              <span style={{ fontWeight: 500 }}>{o.label}</span>
              <div style={cardDescStyle}>{o.desc}</div>
            </label>
          ))}
        </section>
      </div>
    </>
  );
}

// ---------------- Hub 壳 ----------------

export default function SettingsDialog({
  closeAction,
  defaultInteraction,
  initial,
  onClose,
  onSave,
  onOpenProviders,
  onOpenTrash,
  onToast,
}: Props) {
  const [page, setPage] = useState<SettingsPageId>(initial?.page ?? "app");
  const hasProject = !!(initial?.projectPath && initial.projectName);
  const projectPath = hasProject ? (initial?.projectPath as string) : null;
  const [scopeLocked, setScopeLocked] = useState(hasProject);
  const [scope, setScope] = useState<"user" | "project">(hasProject ? "project" : "user");
  // 「应用」页的暂存选择：footer 保存时交给 App 落盘
  const [appPick, setAppPick] = useState<{ action: CloseAction; interaction: "chat" | "terminal" }>({
    action: closeAction,
    interaction: defaultInteraction,
  });
  const [savingApp, setSavingApp] = useState(false);

  const goto = (id: SettingsPageId) => {
    setPage(id);
  };

  const content = (() => {
    switch (page) {
      case "app":
        return (
          <AppPage
            closeAction={closeAction}
            defaultInteraction={defaultInteraction}
            onPick={(action, interaction) => setAppPick({ action, interaction })}
          />
        );
      case "providers":
        return (
          <>
            <div className="cc-h3"><span>供应商切换</span></div>
            <div className="cc-hint">
              供应商管理是独立弹窗（清单存 app 配置，切换 = 整份原子替换 live settings.json，
              设置中心管理的权限 / Hooks / 插件启停在切换时自动跟随——模板没写的键从当前 live 带过去）。
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={onOpenProviders}>
                打开供应商管理
              </button>
            </div>
          </>
        );
      case "perms":
        return <PermsPage scope={scope} projectPath={projectPath} onToast={onToast} />;
      case "hooks":
        return <HooksPage scope={scope} projectPath={projectPath} onToast={onToast} />;
      case "plugins":
        return <PluginsPage onToast={onToast} />;
      case "mcp":
        return <McpPage scope={scope} projectPath={projectPath} onToast={onToast} />;
      case "skills":
        return <SkillsPage scope={scope} projectPath={projectPath} onToast={onToast} />;
      case "agents":
        return <AgentsPage scope={scope} projectPath={projectPath} onToast={onToast} />;
      case "commands":
        return <CommandsPage scope={scope} projectPath={projectPath} onToast={onToast} />;
      case "claudemd":
        return <ClaudeMdPage scope={scope} projectPath={projectPath} onToast={onToast} />;
      case "disk":
        return <DiskPage onOpenTrash={onOpenTrash} onToast={onToast} />;
    }
  })();

  return (
    <Modal
      title="设置"
      width={880}
      className="cc-hub"
      onClose={onClose}
      footer={
        page === "app" ? (
          <>
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={savingApp}
              onClick={async () => {
                setSavingApp(true);
                try {
                  await onSave(appPick.action, appPick.interaction);
                } finally {
                  setSavingApp(false);
                }
              }}
            >
              保存
            </button>
          </>
        ) : undefined
      }
    >
      <div className="cc-hub-nav">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="cc-nav-group">{g.group}</div>
            {g.items.map((it) => (
              <button
                key={it.id}
                type="button"
                className={`cc-nav-item${page === it.id ? " cc-nav-on" : ""}`}
                onClick={() => goto(it.id)}
              >
                {it.icon}
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="cc-hub-main">
        <div className="cc-hub-head">
          <h2>{PAGE_TITLES[page]}</h2>
          {SCOPED_PAGES.has(page) && (
            <ScopeSeg value={scope} onChange={setScope} locked={scopeLocked && scope === "project"} hasProject={hasProject} />
          )}
        </div>
        {scopeLocked && scope === "project" && SCOPED_PAGES.has(page) && (
          <div className="cc-lock-banner">
            <LockIcon size={13} />
            <span>
              已从项目 <b>{initial?.projectName}</b> 的右键菜单进入，scope 锁定为「本项目」
            </span>
            <button type="button" className="linkish" onClick={() => setScopeLocked(false)}>
              解除锁定
            </button>
          </div>
        )}
        <div className="cc-hub-content">{content}</div>
      </div>
    </Modal>
  );
}
