// 设置中心自己的小状态文件（数据根 ccstate.json）。
//
// 与 config.json 分开是刻意的：hooks 的「停用」暂存这类 cc 面状态不属于
// config 模型——加进 config.json 要同步 paths.ts 的 KNOWN_CONFIG_KEYS 表
// （数据根判定契约），为一个布尔清单不值得。独立文件 + 原子写 + .bak，
// 没有并发写方（只有本进程写），不需要 config 锁。
//
// ⚠️ 停用暂存必须存**完整条目**而不只是 id：停用 = 条目从 settings.json 的
// hooks 表移出，此时它的内容只存在于这里；「已停用」列表要渲染出 matcher/
// 命令供用户辨认、再启用要把原条目移回表——只存 id 的话内容就丢了（等于
// 静默删除）。id = `scope|事件|序号|条目内容哈希`：序号参与去重——同一事件
// 下两条逐字相同的条目只停用其一时，靠序号才能区分「被停用的那条」与「留在
// 表里的孪生兄弟」（停用列表按 id 过滤现表行，无序号会把孪生兄弟也藏掉）。
import * as fs from "node:fs";
import * as path from "node:path";
import { writeJsonAtomic } from "./provider";

export interface DisabledHookEntry {
  id: string;
  scope: "user" | "project";
  event: string;
  /** 原 hooks 表条目（{ matcher?, hooks: [...] }），再启用时原样移回 */
  entry: unknown;
}

interface CcState {
  disabledHooks: DisabledHookEntry[];
}

function ccStatePath(root: string): string {
  return path.join(root, "ccstate.json");
}

function asEntry(v: unknown): DisabledHookEntry | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id === "") return null;
  if (o.scope !== "user" && o.scope !== "project") return null;
  if (typeof o.event !== "string" || o.event === "") return null;
  if (!o.entry || typeof o.entry !== "object") return null;
  return { id: o.id, scope: o.scope, event: o.event, entry: o.entry };
}

export function readCcState(root: string): CcState {
  let raw: string;
  try {
    raw = fs.readFileSync(ccStatePath(root), "utf8").replace(/^\uFEFF/, "");
  } catch {
    return { disabledHooks: [] };
  }
  try {
    const obj = JSON.parse(raw) as Partial<CcState>;
    return {
      disabledHooks: Array.isArray(obj.disabledHooks)
        ? obj.disabledHooks.map(asEntry).filter((e): e is DisabledHookEntry => e !== null)
        : [],
    };
  } catch {
    // 写坏不静默重置原文件——只在内存按空处理，下次保存时 .bak 里仍有旧内容
    return { disabledHooks: [] };
  }
}

export function writeCcState(root: string, disabledHooks: DisabledHookEntry[]): void {
  writeJsonAtomic(ccStatePath(root), { disabledHooks });
}
