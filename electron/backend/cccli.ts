// 设置中心「只读 CLI 查询」执行器：统一跑本机 claude 的只读子命令并收集输出。
//
// 目前供两处用：`claude plugin details <name>`（插件组件清单与 projected token cost）、
// `claude mcp get <name>`（连接健康检查）。两者输出都是**文本**（CLI 无 `--json`），
// 由各模块自行解析（解析函数是纯函数、可单测），本模块只管「跑 + 收」。
//
// ⚠️ 只跑**只读**命令。后续安装类（`plugin install/update`）会复用本函数，但那条路
// 必须走 marketplace 声明命令的两阶段确认（见 docs/settings-hub-plan.md Phase 2），
// 不能图省事直接 `-y` 自动接受。
import { spawn } from "node:child_process";
import {
  findClaudeExecutable,
  requireLocalClaudeExecutable,
} from "./chat";
import { buildClaudeCommand } from "./pty";

export interface CliRunResult {
  /** 退出码；进程被杀/启动失败为 null */
  code: number | null;
  stdout: string;
  stderr: string;
  /** 是否因超时被强制终止 */
  timedOut: boolean;
}

/** 默认超时（毫秒）：details 要读插件清单、mcp get 会真连服务器，都比探测类慢 */
export const CLI_TIMEOUT_MS = 60_000;

/** 跑本机 claude 的只读子命令（args 不含可执行路径本身） */
export function runClaude(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<CliRunResult> {
  const exe = requireLocalClaudeExecutable(findClaudeExecutable());
  const loc = buildClaudeCommand(exe);
  return run(loc.file, [...loc.args, ...args], opts);
}

/** spawn 一条命令并收集 stdout/stderr，带超时与 windowsHide（Windows 下不给控制台
 *  子进程另开黑窗）。`cwd` 必传时用于「项目 scope 的 MCP 审批态依赖 cwd」这类命令。 */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<CliRunResult> {
  const timeoutMs = opts.timeoutMs ?? CLI_TIMEOUT_MS;
  return new Promise<CliRunResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: String(e), timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let done = false;
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    const finish = (r: CliRunResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    // 轮询式超时：超时即 kill，避免子进程挂起拖累 UI
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // 已退出：忽略
      }
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", (e) => finish({ code: null, stdout, stderr: String(e), timedOut: false }));
    child.on("close", (code) => finish({ code: code ?? null, stdout, stderr, timedOut: false }));
  });
}
