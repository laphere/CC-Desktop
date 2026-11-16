// IPC 通道契约：preload 与 main 共用的 payload 类型表。
// 每个通道的 payload 是**单个对象**（ipcRenderer.invoke(channel, payload)），
// 主进程 handler 收到的第一个参数是 IpcMainInvokeEvent，经 handle() 包装剥离后
// 才是这里的 payload——两侧签名由本表在编译期对齐，防止参数错位。
//
// 通道集合同时是**渲染进程的能力白名单**：preload 只放行本表里的键
// （`IPC_CHANNELS`），不在表里的一律拒绝。

import type { ChatImage, ChatPermissionMode } from "./backend/chat";
import type { CcScope, DefaultModeChain, HooksMap, PermissionRules } from "./backend/ccsettings";
import type { DisabledHookEntry } from "./backend/ccstate";
import type { McpCheckResult, McpListView, McpScope, McpServerView } from "./backend/ccmcp";
import type { PluginDetails, PluginListView, PluginView } from "./backend/ccplugins";
import type { AssetKind, AssetScope, AssetView, ClaudeMdView } from "./backend/ccassets";
import type { CleanResult, DiskUsage } from "./backend/ccdisk";

// cc 系视图类型在此再导出：渲染层统一从本契约表拿类型（与通道面同源）
export type {
  CcScope,
  DefaultModeChain,
  HooksMap,
  PermissionRules,
  DisabledHookEntry,
  McpCheckResult,
  McpListView,
  McpScope,
  McpServerView,
  PluginDetails,
  PluginListView,
  PluginView,
  AssetKind,
  AssetScope,
  AssetView,
  ClaudeMdView,
  DiskUsage,
  CleanResult,
};

/** cc_perms_read 的返回：project 为 null = 未传 projectPath（用户级视角） */
export interface CcPermsRead {
  user: PermissionRules;
  project: PermissionRules | null;
  defaultMode: DefaultModeChain;
}

/** cc_hooks_read 的返回：disabled = 已停用 hook 条目**带内容**（app 数据根
 *  ccstate.json）——停用时条目已从 settings.json 移出，内容只在这里有 */
export interface CcHooksRead {
  user: HooksMap;
  project: HooksMap | null;
  disabled: DisabledHookEntry[];
}

/** 置顶会话条目（与 config.json 里的形状一致） */
export interface PinnedSessionPayload {
  file: string;
  projectPath: string;
}

/** 可预览的扩展名白名单（小写、含点）：文件预览的**单一真源**——读侧校验
 *  （backend/files.ts）与渲染层识别（src/lib/file-links.ts 的 chip 正则同表）。
 *  扩类型时两处同步，白名单外路径不做 chip、拒绝读取 */
export const PREVIEW_EXTENSIONS = [".md", ".html", ".htm"] as const;

/** 单文件预览读取上限（字节）：读侧（preview_read）与渲染层 html 预挡双挡共用
 *  同一常量；ccpreview:// 协议的子资源不做此限制（目录白名单是它的边界） */
export const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

export interface IpcContract {
  // ---------- 项目清单（路径模型，去脚本化） ----------
  list_projects: void;
  load_config: void;
  /** 保存配置：主进程**读改写**，只覆盖 payload 里出现过的键（缺省 = 不动该字段） */
  save_config: {
    order?: string[];
    pinnedSessions?: PinnedSessionPayload[];
    projects?: string[];
    excluded?: string[];
    dark?: boolean;
    closeAction?: string | null;
    defaultInteraction?: string;
  };
  add_project: { path: string };
  remove_project: { path: string };
  launch_project: { path: string };
  open_folder: { path: string };
  check_claude: void;
  /** Claude Code 更新检查：本地版本 vs npm registry 最新稳定版 */
  claude_update_status: void;
  /** Claude Code 一键升级：返回输出尾部 */
  claude_run_upgrade: void;
  check_projects: { paths: string[] };
  // ---------- 批量添加 ----------
  scan_claude_projects: void;
  get_claude_projects_dir: void;
  /** 清除失效项目的 Claude Code 会话数据（不可恢复），返回删除数 */
  purge_claude_project_data: { paths: string[] };
  // ---------- 会话管理 ----------
  list_sessions: { projectPath: string };
  /** 置顶会话清单（跨项目聚合，按 config 顺序实时解析元数据） */
  list_pinned_sessions: void;
  rename_session: { file: string; newTitle: string };
  delete_session: { file: string };
  list_trashed_sessions: void;
  restore_session: { file: string };
  purge_session: { file: string };
  purge_trash: void;
  get_session_messages: { file: string; offset?: number };
  session_stats: { file: string };
  search_session_messages: { file: string; keyword: string };
  /** 顶栏全局会话搜索（跨项目；只搜**标题/摘要**，不扫正文——内容级搜索由会话页
   *  内的 search_session_messages 承担）。返回 SessionSearchOutcome：results 按
   *  lastModified 倒序、最多 50 条（截断发生在全局排序之后，truncated=true = 还有
   *  更旧的没扫/没列）；每条 result 的 projectPath 是**真实项目路径**（非 mangled
   *  目录名），title 语义与左栏列表同一兜底链（customTitle > aiTitle > 首条用户
   *  消息），正在起名的会话不过滤（有意口径） */
  search_sessions: { keyword: string };
  get_session_user_prompts: { file: string };
  export_session: { file: string; destPath: string; format: string };
  get_usage_stats: { tzOffsetMinutes: number };
  resume_session: { file: string; projectPath: string };
  // ---------- app 内对话（Agent SDK） ----------
  /** 解析会话默认权限模式（项目 local > 项目 > 用户级），未配置返回 null */
  chat_default_permission_mode: { projectPath: string };
  /** 启动对话会话：事件经 `chat:event:<token>` 单向推送（token 由渲染层生成） */
  chat_start: {
    projectPath: string;
    sessionFile: string | null;
    permissionMode: ChatPermissionMode | null;
    token: string;
  };
  /** text 为 "" + images 非空 = 纯图消息（与 v2.0.0 的 `text: String` 同形） */
  chat_send: { sessionId: string; text: string; images: ChatImage[] };
  /** 预热：把该会话的 CLI 进程先起好（`--resume` 也在这时发生）。
   *  与 chat_start 分开是**有意的**：chat_start 只注册不 spawn（多开几个对话 tab
   *  不该各起一个 CLI），预热必须是「用户点继续对话」这种显式动作触发的 */
  chat_prewarm: { sessionId: string };
  chat_interrupt: { sessionId: string };
  chat_set_permission_mode: { sessionId: string; mode: ChatPermissionMode };
  /** 可选模型表（进程没起 / 已退出 → null，前端据此提示「发送首条消息后可选」） */
  chat_models: { sessionId: string };
  /** 运行中热切模型；model 为 null 复位默认。成功后 init 帧经 session_ready 送新模型名 */
  chat_set_model: { sessionId: string; model: string | null };
  /** 斜杠命令表（`/` 补全数据源；进程没起 → null） */
  chat_commands: { sessionId: string };
  /** 撤销最近一轮的文件改动：dryRun=true 只出预览清单（filesChanged/增删行数），
   *  false 真回滚（只回 canRewind + skippedLinks，两条口径不同是 CLI 设计）。
   *  没起进程 / 本 sitting 没跑完过一轮 → null */
  chat_rewind_last: { sessionId: string; dryRun: boolean };
  /** 权限 / 方案审批 / 提问的应答；denyMessage 仅拒绝时生效。
   *  ⚠️ `answers` 是 `AskUserQuestion` 的**唯一**有效回传方式——只回 allow 不带它
   *  等于「用户没选」，不报错但静默失效（见 docs/agent-sdk-interactive-tools.md） */
  chat_permission_response: {
    sessionId: string;
    requestId: string;
    allow: boolean;
    denyMessage?: string;
    /** 提问的选择：key = 题目完整文本（多选逗号分隔） */
    answers?: Record<string, string>;
    /** 用户没选选项、直接打字的自由文本（对应 AskUserQuestionOutput.response） */
    response?: string;
  };
  chat_close: { sessionId: string };
  // ---------- 内嵌终端（node-pty，对齐 Tauri 线 pty_* 命令面） ----------
  /** 启动 claude 终端会话：输出经 `pty:data:<token>`、退出经 `pty:exit:<token>`
   *  单向推送（token 由渲染层生成，先订阅再 invoke——早于应答的事件零丢失） */
  pty_spawn_claude: {
    cwd: string;
    resumeSessionId: string | null;
    newSessionId: string | null;
    cols: number;
    rows: number;
    token: string;
  };
  /** 键盘输入写入 PTY（xterm.js onData 原文） */
  pty_write: { id: number; data: string };
  /** 终端尺寸变更（FitAddon 防抖后调用） */
  pty_resize: { id: number; cols: number; rows: number };
  /** 结束终端会话（先 taskkill /T /F 杀树再 pty.kill；返回 = 树已杀完） */
  pty_kill: { id: number };
  /** 按会话 id 读会话标题（终端 tab 的会话名兜底）；文件未落盘返回 null */
  session_title_for: { projectPath: string; sessionId: string };
  /** app 内新对话的落盘探测：返回会话 jsonl 路径 + 当前标题；文件未落盘/无实质
   *  内容 → null。前端首轮结束后轮询，拿到即把新对话 tab 升级成续聊态 */
  chat_session_meta: { projectPath: string; sessionId: string };
  /** 剪贴板里若放着**图片文件**（资源管理器「复制」），返回其路径；否则 null。
   *  只读不动剪贴板；位图/纯文本/非图片文件/非 Windows 一律 null */
  clipboard_image_path: void;
  /** 把文本写入系统剪贴板（消息区划选右键「复制」） */
  clipboard_write_text: { text: string };
  // ---------- 供应商切换 ----------
  provider_list: void;
  provider_save: { provider: unknown };
  provider_delete: { id: string };
  provider_reorder: { ids: string[] };
  provider_switch: { id: string };
  provider_import_ccswitch: { filePath: string };
  provider_read_live: void;
  fetch_models_for_config: { baseUrl: string; apiKey: string };
  provider_query_usage: { id: string };
  open_url: { url: string };
  // ---------- 文件预览与打开（消息里的生成文件路径 chip） ----------
  // base = 相对路径的解析根（= 会话的项目根）；主进程统一做 `~` 展开与拼接
  /** 系统默认程序打开本地文件（.html = 默认浏览器）。error 为 null = 成功，
   *  非 null = shell.openPath 回执的失败原因（系统语言，可直显） */
  open_file: { path: string; base?: string };
  /** 资源管理器 / Finder 定位并选中文件（OS 层无失败回执，与 open_folder 同款静默） */
  reveal_file: { path: string; base?: string };
  /** 预览前探：存在性 + 是否常规文件 + 字节数（fs 错误一律归为不存在，不 reject）；
   *  resolved = 解析后的绝对路径 */
  preview_stat: { path: string; base?: string };
  /** 读预览内容：扩展名白名单（md/html/htm）+ 10MB 上限，越界 reject（中文原因可直显） */
  preview_read: { path: string; base?: string };
  /** 登记 ccpreview:// 的读盘白名单（被预览文件所在目录 + 项目根，append 上限 16）
   *  并记录当前顶层文档；打开预览浮层前调用 */
  preview_register_roots: { docPath: string; roots: string[] };
  // ---------- 其他 ----------
  get_data_root: void;
  quit_app: void;
  autostart_supported: void;
  autostart_enabled: void;
  autostart_turn_on: void;
  autostart_turn_off: void;
  // ---------- 窗口控制 ----------
  pick_folder: { title: string };
  /** 选择文件（如 CC Switch 的 SQL 备份）；filters 形如 `[{name, extensions}]` */
  pick_file: { title: string; filters?: { name: string; extensions: string[] }[] };
  /** 另存为对话框（导出会话用） */
  save_file: {
    title: string;
    defaultPath: string;
    filters?: { name: string; extensions: string[] }[];
  };
  window_hide: void;
  window_destroy: void;
  /** 标题栏覆盖层跟随主题（Windows/Linux 的 WCO；macOS 为 no-op） */
  window_set_titlebar_theme: { dark: boolean };
  // ---------- 设置中心：Claude Code 配置与扩展（cc 系，见 docs/settings-hub-plan.md） ----------
  /** 权限规则：user+project 两组 + defaultMode 生效链（local > project > user）。
   *  project 为 null = 没传 projectPath（用户级视角打开） */
  cc_perms_read: { projectPath?: string };
  /** 只覆盖 allow/deny/ask 三组；defaultMode / additionalDirectories 等 CLI 键不碰 */
  cc_perms_write: { scope: CcScope; projectPath?: string; rules: PermissionRules };
  /** hooks 两级全表 + 已停用条目（带内容，app 数据根 ccstate.json） */
  cc_hooks_read: { projectPath?: string };
  /** 整表写 hooks（读侧返回完整表、UI 编辑后原样写回，未知事件键不丢）；
   *  disabled 为写后**全局**停用条目全集（带内容） */
  cc_hooks_write: { scope: CcScope; projectPath?: string; hooks: HooksMap; disabled: DisabledHookEntry[] };
  /** 插件 + marketplace 列表（installed_plugins.json 与 enabledPlugins 并集） */
  cc_plugin_list: void;
  /** 启停插件：只翻用户级 enabledPlugins 布尔位 */
  cc_plugin_toggle: { id: string; enabled: boolean };
  /** 插件详情（组件清单 + projected token cost），只读 CLI */
  cc_plugin_details: { name: string };
  /** MCP 三 scope 列表（project/local 为空当没传 projectPath） */
  cc_mcp_list: { projectPath?: string };
  cc_mcp_save: { scope: McpScope; projectPath?: string; name: string; config: unknown };
  cc_mcp_delete: { scope: McpScope; projectPath?: string; name: string };
  /** .mcp.json 服务器的审批（enabled/disabled 名单，projects.<项目键> 下） */
  cc_mcp_approve: { projectPath: string; name: string; approved: boolean };
  /** MCP 连接测试（真做健康检查），cwd 用 projectPath */
  cc_mcp_check: { name: string; projectPath?: string };
  /** 技能/子代理/命令清单；目录未创建返回 []（空态，不是错误） */
  cc_assets_list: { kind: AssetKind; scope: AssetScope; projectPath?: string };
  cc_asset_read: { kind: AssetKind; scope: AssetScope; projectPath?: string; name: string };
  /** skill = 写 <name>/SKILL.md（目录按需创建）；agent/command = 写 <name>.md（支持嵌套段） */
  cc_asset_write: { kind: AssetKind; scope: AssetScope; projectPath?: string; name: string; content: string };
  /** 删除进 app 回收站（trash/cc-assets/<时间戳>/），返回备份路径 */
  cc_asset_delete: { kind: AssetKind; scope: AssetScope; projectPath?: string; name: string };
  /** 两级 CLAUDE.md（missing = 尚未创建，保存即创建）；imports 只展示 */
  cc_claudemd_read: { scope: AssetScope; projectPath?: string };
  cc_claudemd_write: { scope: AssetScope; projectPath?: string; content: string };
  /** ~/.claude 分桶磁盘用量（主进程缓存 10 分钟） */
  cc_disk_usage: void;
  /** 清理可清理桶（白名单见 ccdisk.CLEANABLE_BUCKETS），返回清掉的字节数 */
  cc_disk_clean: { bucket: string };
}

export type IpcChannel = keyof IpcContract;

/** 渲染进程可用的通道白名单（preload 运行时校验；新增通道必须同步这里）。
 *  ⚠️ 必须写成 `as const` 的字面量元组，不能声明成 `readonly IpcChannel[]`——
 *  后者会把元素类型拓宽成整个 `IpcChannel` 联合，下面的穷尽性断言就永远成立、形同虚设
 *  （实测：漏掉一个通道时 tsc 仍然退出 0）。 */
export const IPC_CHANNELS = [
  "list_projects",
  "load_config",
  "save_config",
  "add_project",
  "remove_project",
  "launch_project",
  "open_folder",
  "check_claude",
  "claude_update_status",
  "claude_run_upgrade",
  "check_projects",
  "scan_claude_projects",
  "get_claude_projects_dir",
  "purge_claude_project_data",
  "list_sessions",
  "list_pinned_sessions",
  "rename_session",
  "delete_session",
  "list_trashed_sessions",
  "restore_session",
  "purge_session",
  "purge_trash",
  "get_session_messages",
  "session_stats",
  "search_session_messages",
  "search_sessions",
  "get_session_user_prompts",
  "export_session",
  "get_usage_stats",
  "resume_session",
  "chat_default_permission_mode",
  "chat_start",
  "chat_send",
  "chat_prewarm",
  "chat_interrupt",
  "chat_set_permission_mode",
  "chat_models",
  "chat_set_model",
  "chat_commands",
  "chat_rewind_last",
  "chat_permission_response",
  "chat_close",
  "pty_spawn_claude",
  "pty_write",
  "pty_resize",
  "pty_kill",
  "session_title_for",
  "chat_session_meta",
  "clipboard_image_path",
  "clipboard_write_text",
  "provider_list",
  "provider_save",
  "provider_delete",
  "provider_reorder",
  "provider_switch",
  "provider_import_ccswitch",
  "provider_read_live",
  "fetch_models_for_config",
  "provider_query_usage",
  "open_url",
  "open_file",
  "reveal_file",
  "preview_stat",
  "preview_read",
  "preview_register_roots",
  "get_data_root",
  "quit_app",
  "autostart_supported",
  "autostart_enabled",
  "autostart_turn_on",
  "autostart_turn_off",
  "pick_folder",
  "pick_file",
  "save_file",
  "window_hide",
  "window_destroy",
  "window_set_titlebar_theme",
  "cc_perms_read",
  "cc_perms_write",
  "cc_hooks_read",
  "cc_hooks_write",
  "cc_plugin_list",
  "cc_plugin_toggle",
  "cc_plugin_details",
  "cc_mcp_list",
  "cc_mcp_save",
  "cc_mcp_delete",
  "cc_mcp_approve",
  "cc_mcp_check",
  "cc_assets_list",
  "cc_asset_read",
  "cc_asset_write",
  "cc_asset_delete",
  "cc_claudemd_read",
  "cc_claudemd_write",
  "cc_disk_usage",
  "cc_disk_clean",
] as const;

// ---------------- 白名单与契约的双向断言（编译期） ----------------
// 只声明成类型数组挡不住「漏项」：新增契约键却忘了加进数组时 tsc 照样通过，
// 运行期才在 preload 抛「不允许的 IPC 通道：x」。两个方向都钉住：
/** 多余项：数组里出现契约之外的通道 → 赋值失败 */
const _channelsInContract: readonly IpcChannel[] = IPC_CHANNELS;
/** 漏项：契约里有而数组里没有的通道 → MissingChannel 非 never → 不可赋值给 never */
type MissingChannel = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>;
const _channelsExhaustive: MissingChannel extends never ? true : never = true;
void _channelsInContract;
void _channelsExhaustive;
