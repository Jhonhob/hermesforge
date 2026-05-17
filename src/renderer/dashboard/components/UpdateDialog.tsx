import { X, Download, RotateCcw, Sparkles, FileText } from "lucide-react";
import type { ClientUpdateEvent } from "../../../shared/types";
import { NativeCard, NativeButton, cn } from "../DashboardPrimitives";

interface UpdateDialogProps {
  open: boolean;
  phase: "available" | "downloaded";
  event?: ClientUpdateEvent;
  onClose: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onSkip: () => void;
}

export function UpdateDialog(props: UpdateDialogProps) {
  const { open, phase, event, onClose, onDownload, onInstall, onSkip } = props;
  if (!open) return null;

  const currentVersion = event?.currentVersion ?? "";
  const latestVersion = event?.latestVersion ?? "";
  const releaseNotes = event?.releaseNotes;

  const isAvailable = phase === "available";
  const title = isAvailable ? "发现新版本" : "更新已就绪";
  const Icon = isAvailable ? Download : RotateCcw;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
      <NativeCard className="relative w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {currentVersion && latestVersion ? (
                <span className="inline-flex items-center gap-1">
                  <span className="font-medium text-slate-600">{currentVersion}</span>
                  <span className="text-slate-300">→</span>
                  <span className="font-medium text-indigo-600">{latestVersion}</span>
                </span>
              ) : null}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            type="button"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {isAvailable ? (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-slate-700">
                <FileText size={14} className="text-slate-400" />
                <span>更新内容</span>
              </div>
              <div className="max-h-48 overflow-auto rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                {releaseNotes ? (
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
                    {releaseNotes}
                  </div>
                ) : (
                  <p className="text-[13px] text-slate-400">暂无详细更新说明。</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 px-4 py-3">
              <Sparkles size={16} className="shrink-0 text-emerald-600" />
              <p className="text-[13px] leading-relaxed text-emerald-800">
                更新包已下载完成，重启应用即可安装新版本。
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          {isAvailable ? (
            <>
              <NativeButton variant="ghost" size="sm" onClick={onSkip}>
                跳过本次
              </NativeButton>
              <NativeButton variant="secondary" size="sm" onClick={onClose}>
                稍后提醒
              </NativeButton>
              <NativeButton variant="primary" size="sm" onClick={onDownload}>
                <Download size={14} />
                立即下载
              </NativeButton>
            </>
          ) : (
            <>
              <NativeButton variant="ghost" size="sm" onClick={onClose}>
                稍后重启
              </NativeButton>
              <NativeButton variant="primary" size="sm" onClick={onInstall}>
                <RotateCcw size={14} />
                立即重启安装
              </NativeButton>
            </>
          )}
        </div>
      </NativeCard>
    </div>
  );
}
