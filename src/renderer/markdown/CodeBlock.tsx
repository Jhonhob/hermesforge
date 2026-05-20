import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "../dashboard/DashboardPrimitives";

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  py: "python",
  sh: "bash",
  ps1: "powershell",
  yml: "yaml",
};
export function CodeBlock(props: { code: string; language?: string; minimal?: boolean }) {
  const [copied, setCopied] = useState(false);
  const language = normalizeLanguage(props.language);

  async function copyCode() {
    await navigator.clipboard.writeText(props.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="group my-3 max-w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-950 shadow-[0_14px_34px_rgba(15,23,42,0.14)]">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300">{language}</span>
        <button className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white" onClick={copyCode}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre
        className={cn(
          "overflow-x-auto p-3 font-mono text-[13px] leading-6 text-slate-100",
          props.minimal && "text-[12px]",
      )}
      >
        <code>{props.code}</code>
      </pre>
    </div>
  );
}

function normalizeLanguage(language?: string) {
  const normalized = (language || "text").toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}
