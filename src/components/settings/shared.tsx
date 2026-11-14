// 设置中心各页共用的原子件：分区标题 / 提示行 / 行卡片 / 徽标 / 开关 / scope 切换器 /
// 空态 / 异步加载 hook。样式全部在 styles.css 的「设置中心」段。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// ---------------- 异步数据 hook ----------------

/** 页面级异步加载：挂载/依赖变化自动拉取，暴露 reload。
 *  reload 是**静默**的：已有数据时刷新不翻 loading、不卸载已渲染内容——
 *  保存后重读不能让整页退回「加载中…」（编辑器/滚动位置会丢）；
 *  只有首次（还没有数据）才显示加载态。错误抛字符串（IPC 惯例）。 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const hasDataRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    if (!hasDataRef.current) setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((v) => {
        if (!disposed) {
          hasDataRef.current = true;
          setData(v);
        }
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

// ---------------- 文案 ----------------

/** 字节数人性化（本 app 只在设置中心/健康弹窗用，不带小数点的紧凑格式） */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ---------------- 结构件 ----------------

/** 分组标题（页内一级小节） */
export function H3({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="cc-h3">
      <span>{children}</span>
      {right && <span className="cc-h3-right">{right}</span>}
    </div>
  );
}

/** 灰色提示行（页面口径说明 / 生效提示） */
export function Hint({ children }: { children: ReactNode }) {
  return <div className="cc-hint">{children}</div>;
}

/** 「改动对新会话生效」固定脚注（D6 口径，所有写页共用一条） */
export function EffectiveHint() {
  return <Hint>改动对新会话生效，运行中的会话不受影响。</Hint>;
}

/** 列表行卡片：左内容 + 右操作区 */
export function Card({
  icon,
  title,
  sub,
  ops,
  children,
  onClick,
  faded,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  ops?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  faded?: boolean;
}) {
  return (
    <div className={`cc-card${faded ? " cc-faded" : ""}${onClick ? " cc-clickable" : ""}`} onClick={onClick}>
      {icon && <span className="cc-card-icon">{icon}</span>}
      <div className="cc-card-main">
        <div className="cc-card-title">{title}</div>
        {sub && <div className="cc-card-sub">{sub}</div>}
        {children}
      </div>
      {ops && <div className="cc-card-ops">{ops}</div>}
    </div>
  );
}

/** 状态徽标（ok/accent/star/danger/neutral） */
export function Badge({ kind, children }: { kind: "ok" | "acc" | "star" | "danger" | "mut"; children: ReactNode }) {
  return <span className={`cc-badge cc-badge-${kind}`}>{children}</span>;
}

/** 开关（启用/停用）：纯视觉，状态由调用方管 */
export function Toggle({ on, onClick, disabled, title }: { on: boolean; onClick?: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      className={`cc-switch${on ? " cc-switch-on" : ""}`}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-pressed={on}
    />
  );
}

/** scope 分段切换器（用户级 ↔ 本项目）；locked 时只显示当前档 */
export function ScopeSeg({
  value,
  onChange,
  locked,
  hasProject,
}: {
  value: "user" | "project";
  onChange: (v: "user" | "project") => void;
  locked: boolean;
  hasProject: boolean;
}) {
  if (!hasProject) {
    return <span className="cc-scope-hint">项目级管理请从项目行右键菜单「项目扩展与规则」进入</span>;
  }
  if (locked) {
    return (
      <span className="cc-scope-locked">
        本项目
      </span>
    );
  }
  return (
    <div className="cc-seg">
      <button type="button" className={value === "user" ? "on" : ""} onClick={() => onChange("user")}>
        用户级
      </button>
      <button type="button" className={value === "project" ? "on" : ""} onClick={() => onChange("project")}>
        本项目
      </button>
    </div>
  );
}

/** 空态块（目录未创建 / 无条目） */
export function EmptyState({ icon, title, desc, action }: { icon?: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="cc-empty">
      {icon && <span className="cc-empty-icon">{icon}</span>}
      <div className="cc-empty-title">{title}</div>
      {desc && <div className="cc-empty-desc">{desc}</div>}
      {action}
    </div>
  );
}

/** 加载 / 错误占位 */
export function LoadOrError({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (loading) return <div className="cc-hint">加载中…</div>;
  if (error) return <div className="cc-error">加载失败：{error}</div>;
  return <>{children}</>;
}

/** 页面顶部警示横幅（Hooks 页用） */
export function WarnBanner({ children }: { children: ReactNode }) {
  return <div className="cc-warn">{children}</div>;
}
