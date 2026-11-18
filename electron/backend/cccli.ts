// 设置中心 CLI 执行器：跑本机 claude 的子命令并收集输出。
//
// 两类用途：① **只读查询**（plugin details / mcp get）；② **受控写操作**
// （plugin uninstall、marketplace add/remove/update）。⚠️ 写操作必须经 UI 的
// ConfirmDialog，本模块不替调用方做确认；安装类还需 marketplace 命令的两阶段确认
// （见 docs/settings-hub-plan.md Phase 2），不能图省事直接 `-y`。
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { findClaudeExecutable, requireLocalClaudeExecutable } from "./chat";
import { buildClaudeCommand } from "./pty";

export interface CliRunResult {
  /** 退出码；进程被杀/启动失败为 null */
  code: number | null;
  stdout: string;
  stderr: string;
  /** 是否因超时被强制终止 */
  timedOut: boolean;
}

/** 只读查询超时（details 读清单、mcp get 做健康检查） */
export const CLI_TIMEOUT_MS = 60_000;
/** 写操作超时：marketplace add/update 要 git clone 外部仓库，CLI 自己给的超时是
 *  120s（实测本机 add 一个中等仓库就要 ~55s），应用层不能更早动手。 */
export const CLI_TIMEOUT_LONG_MS = 300_000;

/** 跑本机 claude 的子命令（args 不含可执行路径本身） */
export function runClaude(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; long?: boolean } = {},
): Promise<CliRunResult> {
  const exe = requireLocalClaudeExecutable(findClaudeExecutable());
  const loc = buildClaudeCommand(exe);
  return run(loc.file, [...loc.args, ...args], opts);
}

/** spawn 一条命令并收集 stdout/stderr，带超时与 windowsHide（Windows 下不给控制台
 *  子进程另开黑窗）。`cwd` 必传时用于「项目 scope 的 MCP 审批态依赖 cwd」这类命令。
 *  ⚠️ 超时杀**进程树**：marketplace add/update 会拉起 git、mcp get 会拉起被测服务器，
 *  只 kill 直接子进程会留下孤儿与 `.clone` 半成品。 */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; long?: boolean } = {},
): Promise<CliRunResult> {
  const timeoutMs = opts.timeoutMs ?? (opts.long ? CLI_TIMEOUT_LONG_MS : CLI_TIMEOUT_MS);
  const win = process.platform === "win32";
  return new Promise<CliRunResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        windowsHide: true,
        // POSIX 让子进程当进程组长，超时才能用 process.kill(-pid) 杀整棵树
        detached: !win,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: String(e), timedOut: false });
      return;
    }
    // 逐 chunk 直接 toString 会在多字节字符被切断时产生 U+FFFD，用 StringDecoder 接上
    const out = new StringDecoder("utf8");
    const err = new StringDecoder("utf8");
    let stdout = "";
    let stderr = "";
    let done = false;
    child.stdout?.on("data", (d) => {
      stdout += out.write(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += err.write(d);
    });
    const finish = (r: CliRunResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const killTree = () => {
      if (win) {
        // taskkill /T 连子孙一起杀；spawn 异步发出即可（进程随即要退）
        try {
          spawn(
            process.env.ComSpec || "cmd.exe",
            ["/c", "taskkill", "/pid", String(child.pid ?? ""), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
        } catch {
          // 忽略：随后再尝试直接 kill
        }
      } else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill();
          } catch {
            // 已退出
          }
        }
      }
    };
    // 轮询式超时：超时即杀树，避免子进程挂起拖累 UI
    const timer = setTimeout(() => {
      killTree();
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", (e) => finish({ code: null, stdout, stderr: String(e), timedOut: false }));
    child.on("close", (code) => finish({ code: code ?? null, stdout, stderr, timedOut: false }));
  });
}
