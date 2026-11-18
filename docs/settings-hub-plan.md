# 设置与扩展中心（设置 Hub）实施方案

> 状态：**Phase 1 已实施并过两轮评审**（2026-11-14 方案评审；2026-11-15 代码评审后端/前端各一，P0/P1 已修复，测试 537 ✓ + CDP 冒烟 30/30）· **Phase 2 低风险批 + 只读探针批 + 写操作批已落地（2026-11-16/18）**：磁盘分桶清理 / Hooks 保存期禁用 / 插件详情与 token 成本 / MCP 连接测试 / marketplace 管理 / 插件卸载 · 交互原型：`docs/prototype/settings-hub.html`（高保真，视觉 token 逐值取自 `styles.css`）
> 目标：把 Claude Code 的插件 / MCP / 技能 / 子代理 / 命令 / 权限规则 / Hooks / CLAUDE.md 管理收进设置弹窗（左导航多页），外加磁盘占用体检。
> 生效原理（已实测，方案成立的前提）：app 内对话层**不传 `settingSources`**（`chat.ts` 注释），CLI 默认加载 user+project+local 三层设置；终端会话天然读配置。**改文件 = 新会话即生效**，无需 SDK 参与；SDK 也没有管理 API。

## 0. 分期

- **Phase 1（本次实施）**：纯文件读写的管理面——设置 Hub 骨架 + 插件（列表/启停）/ MCP（三 scope 增删改）/ 技能 / 子代理 / 命令 / 权限规则 / Hooks / CLAUDE.md / 磁盘占用，共 10 页 + 项目右键菜单入口 + 健康检查弹窗磁盘段。
- **Phase 2**：
  - **已做（2026-11-16）**：磁盘分桶清理（`ccdisk.cleanDiskBucket` + `cc_disk_clean`，保守 5 桶，详见 CLAUDE.md）、HooksPage persist 在飞禁用操作钮。
  - **已撤（2026-11-16）**：原计划的统计弹窗「提示词历史」tab 不做——它只是 `history.jsonl` 的流水列表（非统计），跨会话找 prompt 的场景弱，且与会话页全文搜索/顶栏标题搜索重叠；真要做需先补「点条目跳回会话」才有意义。
  - **已做（2026-11-16，只读批）**：插件详情 / projected token 成本（`claude plugin details`，文本解析 + `cc_plugin_details`）、MCP 连接测试（`claude mcp get` 健康检查 + `cc_mcp_check`，cwd 传项目目录）。
  - **已做（2026-11-18，写操作批）**：marketplace 增删改 + 插件卸载（`cc_marketplace_add|remove|update` / `cc_plugin_uninstall`，全部走 CLI `--json` + `ConfirmDialog` 二次确认）；marketplace 列表改为 `known_marketplaces.json` 与 `settings.json → extraKnownMarketplaces` 的**并集**（`mergeMarketplaces` + `ccsettings.readExtraKnownMarketplaces`）。
  - **未做**：`plugin install/update`（需 marketplace 声明命令的**两阶段确认**——先 `--json` 拿 `shownCommand.sha256`、用户确认后带 `--accept-command` 重跑，不默认 `-y`；还要新做可用插件选择器，`list --json --available` 实测 2597 条需搜索）、运行中会话 `reload_plugins`（SDK `Query.reloadPlugins`，非 CLI）。
  - ⚠️ 探针结论（CLI 2.1.325）：`plugin list/marketplace list/enable/disable/uninstall/install/update` 有 `--json`；`plugin details` 与 `mcp get/list` 只有文本（已做容错解析）；**`--json` 那行与人类消息的先后顺序不固定**（实测 uninstall 失败 JSON 在前、marketplace update 成功只有 JSON 一行），故解析逐行找含 `outcome`/`command` 的 JSON。

Phase 1 内**零新 npm 依赖**（纯 fs + 既有工具）；一切 spawn 类操作推迟到 Phase 2。

## 1. 配置文件地图（本机 2.1.319 实测）

| 域 | 读 | 写 |
|---|---|---|
| 插件已装清单 | `~/.claude/plugins/installed_plugins.json`（v2：`plugin@marketplace` → `[{scope,installPath,version,…}]`） | 只读（安装/卸载在 Phase 2 走 CLI） |
| marketplace 注册表 | `~/.claude/plugins/known_marketplaces.json` | 只读（Phase 2） |
| 插件启停 | `~/.claude/settings.json → enabledPlugins`（布尔表） | 同左（只改布尔） |
| MCP user scope | `~/.claude.json` 顶层 `mcpServers` | 同左 |
| MCP local scope | `~/.claude.json → projects.<原始路径键>.mcpServers` | 同左 |
| MCP project scope | `<项目>/.mcp.json` | 同左 |
| MCP 审批态 | `projects.<原始路径键>.enabledMcpjsonServers / disabledMcpjsonServers` | 同左 |
| 权限 / Hooks | `~/.claude/settings.json` 与 `<项目>/.claude/settings.json` 的 `permissions` / `hooks` | 同左 |
| 技能 | `~/.claude/skills/<名>/SKILL.md`、`<项目>/.claude/skills/` | 目录增删改 |
| 子代理 / 命令 | `~/.claude/{agents,commands}/*.md`、`<项目>/.claude/{agents,commands}/` | 同左 |
| CLAUDE.md | `~/.claude/CLAUDE.md`、`<项目>/CLAUDE.md` | 原子写 |
| 磁盘 | `~/.claude/{projects,file-history,plugins,paste-cache,plans,…}`、`history.jsonl` | 只读 |

⚠️ 实测陷阱：`settings.json → enabledPlugins` 里有 `@anthropic-agent-skills`（官方内置 marketplace）的条目而 `installed_plugins.json` **没有**——插件列表必须**两处取并集**，并给内置条目打「内置」徽标（无 installPath、无卸载按钮）。
⚠️ `~/.claude.json` 是 CLI 高频**整份回写**的状态文件（numStartups/tipsHistory 等几十个键），任何写都必须「写前重读最新 → 只改目标键 → 保留全部未知键 → 原子写」。
⚠️ **`.claude.json` 的 `projects` 键是原始路径（正斜杠 resolve 形式），不是会话目录的 mangle 形式**（本机 44 键实测 0 个 mangled；且同一项目可能正/反斜杠双键并存）——读写定位规则见 §3 第 6 条。

## 2. 代码库可复用面（已核对）

| 需求 | 现成设施 |
|---|---|
| 原子写 | `provider.ts` 的 **`writeFileAtomic(filePath, content)`**（写 .tmp → .bak → rename，已导出）+ `writeJsonAtomic(filePath, value)` |
| Claude 配置根定位 | **复用 `provider.ts` 的 `claudeConfigDir()`**（`CLAUDE_CONFIG_DIR` trim 非空 ? 它 : `~/.claude`，供应商模块现役）——实施时把它挪到 `paths.ts` 统一出口、provider.ts 改为引用，cc 系模块一律用它，不另造 `ccRootDir()`；`claudeProjectsDir` 的同款优先级照旧 |
| 项目路径键 | `.claude.json` 的 `projects` 键**不是** mangle 形式——ccmcp 用「分隔符归一匹配现存键」策略（§3 第 6 条）；`mangle.ts` 的 `mangleProjectPath` 只继续服务会话数据目录（磁盘统计用它分桶） |
| 回收站 | `trash.ts` 的 `utcTimestamp` + 数据根 `trash/` 体系；技能等资产删除新增通用 `movePathToTrash`（同语义：先搬后删、恢复目标存在即拒绝由恢复侧保证） |
| IPC | **契约表驱动**：`electron/ipc-contract.ts`（通道 + payload 类型 + `IPC_CHANNELS` 白名单）→ `main.ts` 的 `handle()` → `preload.ts` 通用 invoke → `src/lib/api.ts` 命名包装。新增通道四处同步（比铁律 4 说的三处多一张契约表） |
| 图标 | `Icons.tsx`（Lucide 风格，44 个导出）缺：Puzzle / Plug / Wand / Bot / Shield / Workflow(Hooks) / HardDrive / Lock——补 8 个 |
| 错误语义 | handler 经 `wrap()` 抛字符串（对齐 Tauri Err），渲染层 catch 显示 |

## 3. 后端架构（新模块，全在 `electron/backend/`）

```
ccsettings.ts   ccRootDir()；readJson/写 settings.json（user/project 两级）；permissions、hooks 的读改写
ccmcp.ts        ~/.claude.json 读改写（user/local/审批态，projects 键按归一路径匹配现存键）；<项目>/.mcp.json 读改写
ccplugins.ts    installed_plugins.json + known_marketplaces.json 读；enabledPlugins 并集视图与启停写
ccassets.ts     skills/agents/commands 目录扫描 + SKILL.md/*.md 读写删（删走回收站）；CLAUDE.md 读写 + @import 提取
ccdisk.ts       ~/.claude 分桶用量统计（异步走查 + 10min 进程内缓存）
```

**统一写原则**（每条都是硬性要求）：
1. 所有 JSON 落盘走 `writeFileAtomic`，JSON.stringify 2 空格缩进；
2. 读改写模式：**现读 → 改 → 原子写**，函数内不持有旧快照跨写（`.claude.json` 并发回写风险的唯一缓解就是缩短窗口 + 保留未知键）；
3. 写 `~/.claude.json` 时若文件不存在则从 `{}` 起步；**读路径** parse 失败先短延迟（~150ms）重试一次（CLI 正在整份回写时可能读到撕裂的半份 JSON，文件本身是好的），再失败才抛可读错误、**不静默重置**；**写路径** parse 失败即停不写；
4. `.claude.json` 的定位：`CLAUDE_CONFIG_DIR` 非空且 `<cfgDir>/.claude.json` 存在 ? 用它 : `~/.claude.json`（读和写用**同一个**解析结果，探针点：两种环境都验）；
5. 文本资产（SKILL.md/*.md/CLAUDE.md）写前留 `.bak`（`writeFileAtomic` 自带）；
6. `.claude.json` 的 **projects 键定位**：目标路径与现存键做分隔符归一匹配（`\` ↔ `/`），命中即用**原键**写回（保住该键下 CLI 的其余状态字段）；无命中才新建键，新建规范形式 = `path.resolve` 的正斜杠形式（Phase 1 落地时探针验证一次：增删一条 local MCP 后 diff `.claude.json`，确认 CLI 认账）；同项目正/反斜杠双键并存时**读合并展示、写命中键**。
5. 文本资产（SKILL.md/*.md/CLAUDE.md）写前留 `.bak`（`writeFileAtomic` 自带）；

### IPC 新增通道（17 个，进 `IpcContract` + `IPC_CHANNELS`）

```
cc_perms_read    { projectPath?: string }                      → { user: PermsView, project: PermsView | null }
cc_perms_write   { scope: 'user'|'project', projectPath?, permissions: {allow,deny,ask,defaultMode?} }
cc_hooks_read    { projectPath?: string }                      → { user: HooksMap, project: HooksMap | null, disabled: DisabledHookEntry[] }
cc_hooks_write   { scope, projectPath?, hooks: HooksMap, disabled: DisabledHookEntry[] }  // disabled = 全局停用条目全集（带内容）
cc_plugin_list   void                                          → { plugins: PluginView[], marketplaces: MarketView[] }
cc_plugin_toggle { id: string, enabled: boolean }
cc_mcp_list      { projectPath?: string }                      → { user: McpView[], project: McpView[], local: McpView[], approvals: {enabled,disabled} }
cc_mcp_save      { scope: 'user'|'project'|'local', projectPath?, name, config: McpConfig }
cc_mcp_delete    { scope, projectPath?, name }
cc_mcp_approve   { projectPath, name, approved: boolean }      // enabledMcpjsonServers / disabledMcpjsonServers
cc_assets_list   { kind: 'skill'|'agent'|'command', scope: 'user'|'project', projectPath? } → AssetView[]
cc_asset_read    { kind, scope, projectPath?, name }           → { path, content }
cc_asset_write   { kind, scope, projectPath?, name, content }  // skill = 写 <name>/SKILL.md
cc_asset_delete  { kind, scope, projectPath?, name }           // 进回收站
cc_claudemd_read { scope, projectPath? }                       → { path, content, imports: string[], missing: boolean }
cc_claudemd_write{ scope, projectPath?, content }
cc_disk_usage    void                                          → { total, buckets: {name,size}[] }  // 缓存 10min
```

（`AssetView = { name, dir?, path, description?, size, mtime, missing? }`；electron-api.d.ts 由契约表泛型驱动，**无需改动**。）

## 4. 前端架构

- **`SettingsDialog.tsx` 升级为 Hub**：现有应用设置内容原样迁入「应用」页（第一个导航项，默认页）；弹窗改为左右两栏（导航 208px + 内容区），Modal 体系/出场动画/Esc 守卫全部沿用现有 Modal 组件与 `animateModalClose` 约定（成功关闭 `force=true`）。
- 新增 `src/components/settings/`（本仓 components 首个 per-feature 子目录，页面多、单文件会破千行）：
  - `shared.tsx`：`ScopeSeg`（用户级/本项目分段切换器）、`PageCard`、`Toggle`、空态块、`PageHint`；
  - `PluginsPage.tsx`、`McpPage.tsx`、`SkillsPage.tsx`、`AssetsPage.tsx`（子代理+命令两页共用）、`PermsPage.tsx`、`HooksPage.tsx`、`ClaudeMdPage.tsx`、`DiskPage.tsx`；
  - 「供应商」页不新建——导航项点击直接 `onOpenProviders()`（跳现有 ProviderDialog）。
- **`App.tsx`**：项目右键菜单追加「项目扩展与规则」→ `openSettings({ page, lockedProject })`；`lockedProject` 非空时 Hub 头部渲染锁横幅、各页 ScopeSeg 锁定在「本项目」。⚠️ `ContextMenu.tsx` 的底部防截断预留（现按「标题+5 项+2 分隔」量了 260px）要随新菜单项同步上调；`settingsOpen` 从布尔改对象态后要防同栈双开（右键菜单与 Modal 并存时）。供应商页跳转是**叠弹窗**（压着 Hub 开 ProviderDialog），守动画铁律②③：栈顶定标、被压弹窗清态不包 `animateModalClose`。
- **`HealthDialog.tsx`**：追加「磁盘占用」段（`cc_disk_usage` 弹窗打开时拉一次）+「在设置中查看全部」跳转。
- **`Icons.tsx`** 补 8 个图标；所有新按钮沿用 `btn/btn-sm/btn-primary` 与 `.icon-btn` 系，**新增按钮类按 UI 约定逐像素复测居中**。
- 样式：新类集中加在 `styles.css` 一段（`/* ===== 设置中心 ===== */`），复用 `--dur-*`/`--ease-*` token，不散写字面值。

### 逐页交互规格（Phase 1）

| 页 | 读 | 写 | 交互要点 |
|---|---|---|---|
| 权限规则 | user+project `permissions` | 对应 scope 整写 `permissions` | allow/deny/ask 三组 chip 行（单条删除）；文本框添加（回车/按钮）；defaultMode 只读徽标按**生效链**判定（`settings.local.json` > 项目 `settings.json` > 用户级，标注来源文件，无配置显示「跟随 CLI 默认」——app 不改它）；`additionalDirectories` v1 只读展示 |
| Hooks | user+project `hooks` | 对应 scope 整写 `hooks` | 事件×matcher×command 列表 + 启停开关（`disableBypassPermissionsMode` 式布尔写在 hook 条目 `disable` 字段？——**不**：CLI 无此字段，启停=从表移入/移出）；新增走结构化表单；保存前 JSON 校验 + 顶部警示横幅 |
| 插件 | installed+enabledPlugins 并集 | `enabledPlugins[id]` | 启停开关；内置条目无开关外操作；安装/更新/卸载按钮置灰带「Phase 2」title；marketplace 列表只读 |
| MCP | 三 scope + 审批态 | 对应位置；审批写 `enabledMcpjsonServers` | 三段列表（用户级/共享/私有）各带来源徽标；表单为 JSON textarea + stdio/http/sse 模板按钮（v1 口径，与供应商表单「JSON 为唯一事实来源」同约定；结构化字段表单延后）；「待审批」条目给批准/拒绝按钮（`enableAllProjectMcpServers` 开启时拒绝报错指引去 CLI 关全局批准）；项目共享段加 hint「.mcp.json 在项目根，注意 git 提交范围」 |
| 技能 | 目录扫描 | 建目录+SKILL.md / 删进回收站 | 卡片网格；点击展开 SKILL.md 编辑器；新建=输入名字生成骨架 |
| 子代理/命令 | `*.md` 扫描 | 建改删同上 | 同技能，单文件即条目；命令页注明「插件命令归插件页」 |
| CLAUDE.md | 两级文件 | 原子写 | textarea 编辑 + 保存；@import 提示 chips（只展示不改写） |
| 磁盘占用 | ccdisk | 无 | 分桶条 + 总量（走查不 follow 符号链接/junction，防环与重复计数）；桶含 projects / file-history / plugins(cache+marketplaces) / paste-cache / history.jsonl / plans / trash/cc-assets / 其余杂项；「会话数据」桶给「查看回收站」入口；Phase 2 已开放 5 桶清理（`paste-cache`/`plugin-cache`/`history-jsonl`/`plans`/`cc-assets-trash`），其余桶只展示 |

## 5. 关键设计决策

- **D1 scope 模型**：v1 管理 user + project 两级；`settings.local.json`、`CLAUDE.local.md` 不进 UI（后续按需）。MCP 额外有 local scope（落在 `.claude.json` 项目键内，天然属于三 scope 之一）。
- **D2 `.claude.json` / `settings.json` 并发写**：接受「与运行中 CLI 并发回写可能丢一次更新」的残余风险（CLI 两个终端并发写彼此也一样；settings.json 也有并发写方——CLI 会话内改档位会写它），靠缩短写窗口 + 未知键保留 + 读路径重试兜底；页面上不加锁提示（对齐 CLI 自身行为）。
- **D3 插件启停只写用户级** `enabledPlugins`，插件页无 scope 切换（CLI 的项目级 enabledPlugins 优先级规则复杂，v1 不碰）。
- **D4 Hooks 启停**：CLI 无 per-hook disable 字段，启停 = 从 `hooks` 表移出/移入。停用暂存**持久化到 app 自己的数据根**：`ccstate.json`（独立小文件，原子写 + .bak，不进 config.json 模型、不动 `KNOWN_CONFIG_KEYS` 同表约束），存**完整条目**（`{id, scope, event, entry}[]`，id = `scope|事件|序号|条目内容哈希`，序号用于区分同事件下逐字相同的孪生条目）——只存 id 的话条目内容随移出丢失，「已停用」区无法渲染、再启用无从还原（等于静默删除，代码评审实锤过的方案）。恢复 = 按存储条目移回 hooks 表；`cc_hooks_write.disabled` 是**全局**全集（各 scope 写操作带上其他 scope 的暂存条目，整份写回）。
- **D5 破坏性操作**：技能/子代理/命令删除一律先搬数据根 `trash/cc-assets/<时间戳>/` 再删原位；CLAUDE.md / settings 写坏由 `.bak` 兜底。恢复入口 v1 不做（回收站弹窗只管会话，Phase 2 评估扩面）。
- **D6 新会话生效口径**：每页底部固定一行 hint「改动对新会话生效，运行中的会话不受影响」（app 内对话 prewarm 已拉起进程的极小窗口除外，不特别提示）。
- **D9 供应商切换的键跟随**：`provider.ts` 切换是**整份 settings.json 替换**，Hub 改过的 `permissions`/`hooks`/`enabledPlugins` 会被目标供应商的旧快照静默回滚。修法（进 Phase 1）：`switchProviderFrom` 写入前记快照，写入后对 `CARRYOVER_KEYS = ['permissions','hooks','enabledPlugins']` 逐键——**目标模板含该键则模板赢，否则从切换前 live 带过去**；配回归单测（改 permissions → 切走 → 切回 → permissions 仍在）。
- **D7 磁盘统计**：异步 fs.stat 走查，主进程缓存 10 分钟；>200ms 的首次计算不阻塞 UI（前端 loading 态）。
- **D8 不做的**（v1 内）：运行中会话热重载、订阅额度、订阅/SDK 面的一切、settings.local.json 编辑、插件安装类 spawn（见 §0）。

## 6. 测试计划

- **单测**（vitest node 环境，延续 `npm test`）：`ccsettings.test.ts`（未知键保留 / 缺文件 / BOM / enabledPlugins 布尔写）、`ccmcp.test.ts`（三 scope 读写 / **projects 键归一匹配含正反斜杠双键 fixture** / `.claude.json` 其余项目键与状态字段不被破坏 / **半份 JSON 输入的重试与报错** / `.mcp.json` 往返 / 审批态写）、`ccassets.test.ts`（frontmatter 解析 / 建删 / 回收站搬移 / 递归命令目录）、`ccdisk.test.ts`（临时目录分桶求和）、**provider 切换键跟随回归**（改 permissions → 切走 → 切回 → permissions 仍在；目标模板含 permissions 则模板赢）。夹具全用 `os.tmpdir()` + afterEach 清理；cc 系模块把 `env`/根路径做成可注入参数（照 `claudeProjectsDir` 惯例），涉及缓存的 reset 函数照 `resetRootCache` 惯例导出。
- **回归命令**：`export PATH="/e/DevTool/node:$PATH" && npm test && npm run typecheck && npm run build`（shell 默认 node 是 v12，必须先切 v24）。
- **手工回归清单**：终端新会话 / app 内新对话各自确认启停插件、增删 MCP、改权限规则后生效；供应商切换（写同一份 settings.json）与本功能互不踩；浅/深主题下新按钮居中复测；项目右键菜单锁定态进出。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| `.claude.json` 写坏（CLI 状态大文件） | parse 失败不写、抛可读错；写走原子替换；未知键逐字保留；单测覆盖「其余项目键不丢」 |
| 供应商切换整文件替换回滚 Hub 改动 | **D9 键跟随**：切换后对 `CARRYOVER_KEYS`（permissions/hooks/enabledPlugins）目标模板含则模板赢、否则从切换前 live 带过去；配「切走→切回」回归单测 |
| Hooks 写坏导致 CLI 启动异常 | 保存前 JSON schema 校验（事件名白名单）+ 顶部警示；`.bak` 兜底 |
| 内置 marketplace 插件误判 | 并集策略 + 「内置」徽标；无 installPath 时禁用卸载/详情 |
| `CLAUDE_CONFIG_DIR` 用户自定义根 | `ccRootDir()` 与 `claudeProjectsDir` 同优先级；手工回归加一项 |
| 大量新按钮的居中/样式回归 | 新样式集中一段；逐像素复测记录进 styles.css 注释（照既有惯例） |
| hooks 孪生条目的显示层边缘 | 同事件下两条逐字相同的条目停用其一时，幸存行 idx 移位重算 id 会与暂存条目重合 → 被误藏出「已启用」列表（仅显示层，条目实际活跃无数据影响）；「序号+哈希」id 的固有局限，已接受 |
