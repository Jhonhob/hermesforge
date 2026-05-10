import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { EngineId, TaskType } from "../../shared/types";

export type BadgeTone = "blue" | "cyan" | "green" | "amber" | "slate" | "red";

export const shadows = {
  none: "shadow-none",
  sm: "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
  md: "shadow-[0_4px_12px_rgba(15,23,42,0.06)]",
  lg: "shadow-[0_8px_25px_rgba(15,23,42,0.08)]",
  xl: "shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)]",
};

export const radii = {
  sm: "rounded-lg",
  md: "rounded-xl",
  lg: "rounded-2xl",
  full: "rounded-full",
};

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function NativeIconBox(props: { icon: LucideIcon; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = props.icon;
  const sizes = {
    sm: "h-7 w-7",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };
  const iconSizes = {
    sm: 14,
    md: 16,
    lg: 18,
  };
  const size = props.size ?? "md";
  return (
    <span className={cn("native-icon-box shrink-0 rounded-lg bg-slate-50", sizes[size], props.className)}>
      <Icon size={iconSizes[size]} strokeWidth={1.5} />
    </span>
  );
}

export function NativeBadge(props: { tone: BadgeTone; label: string; pulse?: boolean }) {
  const tones: Record<BadgeTone, { bg: string; text: string; dot: string }> = {
    blue: { bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500" },
    cyan: { bg: "bg-cyan-50", text: "text-cyan-700", dot: "bg-cyan-500" },
    green: { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
    slate: { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
    red: { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
  };
  const tone = tones[props.tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", tone.bg, tone.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot, props.pulse && "animate-pulse")} />
      {props.label}
    </span>
  );
}

export function NativeCard(props: { children: ReactNode; className?: string; hoverable?: boolean }) {
  return (
    <section
      className={cn(
        "bg-white ring-1 ring-slate-100/60",
        radii.lg,
        shadows.md,
        props.hoverable && "transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5",
        props.className
      )}
    >
      {props.children}
    </section>
  );
}

export function MetricLabel(props: { label: string; value: string; detail?: string; tone?: BadgeTone }) {
  return (
    <div className={cn("bg-[#f8f9fa] p-3", radii.md)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-400">{props.label}</span>
        {props.tone && <span className={cn("h-1.5 w-1.5 rounded-full", dotToneClass(props.tone))} />}
      </div>
      <strong className="mt-1.5 block truncate text-sm font-semibold text-slate-800">{props.value}</strong>
      {props.detail && <small className="mt-1 block truncate text-xs text-slate-400">{props.detail}</small>}
    </div>
  );
}

export function SectionTitle(props: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        {props.eyebrow && <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">{props.eyebrow}</p>}
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">{props.title}</h3>
      </div>
      {props.action}
    </div>
  );
}

export function NativeButton(props: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm hover:shadow-md",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150",
        "active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-indigo-200",
        variants[props.variant ?? "primary"],
        sizes[props.size ?? "md"],
        props.disabled && "opacity-50 cursor-not-allowed pointer-events-none",
        props.className
      )}
      onClick={props.onClick}
      type={props.type ?? "button"}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export const taskOptions: Array<{ id: TaskType; label: string; detail: string }> = [
  { id: "fix_error", label: "修复报错", detail: "项目无法运行、命令失败、依赖冲突。" },
  { id: "generate_web", label: "生成网页", detail: "把想法变成可预览的界面。" },
  { id: "analyze_project", label: "分析项目", detail: "看懂目录、启动方式和风险。" },
  { id: "organize_files", label: "整理文件", detail: "归类资料、生成说明和记录。" },
];

export function engineLabel(engine: EngineId | "client" | string) {
  if (engine === "hermes") return "Hermes";
  if (engine === "client") return "客户端";
  return engine;
}

export function taskLabel(taskType: TaskType) {
  return taskOptions.find((task) => task.id === taskType)?.label ?? "自定义";
}

export function formatShortDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatToken(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${value}`;
}

export function formatCost(value: number) {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

export function dotToneClass(tone: BadgeTone) {
  const tones: Record<BadgeTone, string> = {
    blue: "bg-indigo-500",
    cyan: "bg-indigo-400",
    green: "bg-indigo-500",
    amber: "bg-amber-500",
    slate: "bg-slate-400",
    red: "bg-rose-500",
  };
  return tones[tone];
}
