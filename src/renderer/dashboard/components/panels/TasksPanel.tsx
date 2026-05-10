import { useEffect, useState } from "react";
import { AlertCircle, CalendarClock, Play, Pause, RotateCcw, Save, Trash2, Plus } from "lucide-react";
import type { HermesCronJob, HermesGatewayStatus } from "../../../../shared/types";
import { useAppStore } from "../../../store";
import { cn } from "../../DashboardPrimitives";
import { CronEditor } from "../CronEditor";
import { ConfirmCard } from "../ConfirmCard";
import { NoticeCard } from "../NoticeCard";

export function TasksPanel() {
  const store = useAppStore();
  const jobs = store.webUiOverview?.crons ?? [];
  const [editing, setEditing] = useState<Partial<HermesCronJob> | undefined>();
  const [confirming, setConfirming] = useState<{ action: "delete" | "pause" | "resume" | "run"; job: HermesCronJob } | undefined>();
  const [message, setMessage] = useState("");
  const [gateway, setGateway] = useState<HermesGatewayStatus | undefined>();

  useEffect(() => {
    void refreshGateway();
  }, []);

  async function refresh() {
    store.setWebUiOverview(await window.workbenchClient.getWebUiOverview());
  }

  async function refreshGateway() {
    setGateway(await window.workbenchClient.getGatewayStatus().catch(() => undefined));
  }

  async function startGateway() {
    const result = await window.workbenchClient.startGateway();
    setGateway(result.status);
    setMessage(result.message);
  }

  async function runAction(action: NonNullable<typeof confirming>["action"], job: HermesCronJob) {
    try {
      const result =
        action === "delete" ? await window.workbenchClient.deleteCronJob(job.id) :
        action === "pause" ? await window.workbenchClient.pauseCronJob(job.id) :
        action === "resume" ? await window.workbenchClient.resumeCronJob(job.id) :
        await window.workbenchClient.runCronJob(job.id);
      setMessage(result.message || `${job.name} 已${actionLabel(action)}`);
      setConfirming(undefined);
      await refresh();
      await refreshGateway();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${job.name} ${actionLabel(action)}失败。`);
      setConfirming(undefined);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <CalendarClock size={14} />
          <span>读取并编辑 ~/.hermes/crons 下的定时任务配置。</span>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md active:scale-[0.98]"
          onClick={() => setEditing({ name: "", schedule: "every 1h", prompt: "", status: "active" })}
          type="button"
        >
          <Plus size={14} />
          新建任务
        </button>
      </div>

      {gateway && !gateway.running ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex min-w-0 gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Hermes Gateway 未运行，定时任务不会自动触发。</p>
              <p className="mt-1 text-xs text-amber-700">任务会保存到 Hermes 原生 cron；启动 Gateway 后才会按计划执行。</p>
            </div>
          </div>
          <button className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700" onClick={() => void startGateway()} type="button">
            启动 Gateway
          </button>
        </div>
      ) : null}

      {message ? <NoticeCard text={message} onClose={() => setMessage("")} /> : null}
      {confirming ? <ConfirmCard title={`${actionLabel(confirming.action)}：${confirming.job.name}`} body={confirmBody(confirming.action)} tone={confirming.action === "delete" ? "danger" : "normal"} onCancel={() => setConfirming(undefined)} onConfirm={() => void runAction(confirming.action, confirming.job)} /> : null}
      {editing ? <CronEditor value={editing} onChange={setEditing} onCancel={() => setEditing(undefined)} onSave={() => void saveJob()} /> : null}

      {jobs.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {jobs.map((job) => (
            <section
              key={job.id}
              className={cn(
                "group relative overflow-hidden rounded-xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:border-slate-200 hover:shadow-md",
                job.status === "paused" && "opacity-75"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{job.name}</h3>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        job.status === "active"
                          ? "bg-emerald-100 text-emerald-700"
                          : job.status === "paused"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                      )}
                    >
                      {job.status === "active" ? "运行中" : job.status === "paused" ? "已暂停" : "状态未知"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                    <CalendarClock size={12} />
                    <code className="font-mono">{job.schedule}</code>
                    {job.noAgent ? <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-700">no_agent</span> : null}
                  </div>
                  {job.prompt && (
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">{job.prompt.slice(0, 120)}{job.prompt.length > 120 ? "..." : ""}</p>
                  )}
                  {job.script ? <p className="mt-1 truncate text-xs text-slate-400">script: {job.script}</p> : null}
                  {job.workdir ? <p className="mt-1 truncate text-xs text-slate-400">workdir: {job.workdir}</p> : null}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex gap-1.5">
                  {job.status === "active" ? (
                    <button
                      className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-50"
                      onClick={() => setConfirming({ action: "pause", job })}
                      type="button"
                    >
                      <Pause size={12} />
                      暂停
                    </button>
                  ) : (
                    <button
                      className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50"
                      onClick={() => setConfirming({ action: "resume", job })}
                      type="button"
                    >
                      <Play size={12} />
                      恢复
                    </button>
                  )}
                  <button
                    className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                    onClick={() => setConfirming({ action: "run", job })}
                    type="button"
                  >
                    <RotateCcw size={12} />
                    运行
                  </button>
                </div>
                <div className="flex gap-1">
                  <button
                    className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    title="编辑"
                    onClick={() => setEditing({ ...job })}
                    type="button"
                  >
                    <Save size={13} />
                  </button>
                  <button
                    className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    title="删除"
                    onClick={() => setConfirming({ action: "delete", job })}
                    type="button"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-slate-100">
            <CalendarClock size={28} className="text-slate-400" />
          </div>
          <p className="mt-4 text-sm text-slate-500">暂无定时任务</p>
          <p className="mt-1 text-xs text-slate-400">创建后会写入 ~/.hermes/crons</p>
          <button
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700"
            onClick={() => setEditing({ name: "", schedule: "every 1h", prompt: "", status: "active" })}
            type="button"
          >
            <Plus size={14} />
            创建第一个任务
          </button>
        </div>
      )}
    </div>
  );

  async function saveJob() {
    const hasScript = Boolean(editing?.script?.trim() || editing?.scriptContent?.trim());
    if (!editing?.name?.trim() || !editing.schedule?.trim() || (editing.noAgent ? !hasScript : !editing.prompt?.trim())) return;
    const job: Partial<HermesCronJob> = {
      id: editing.id,
      name: editing.name.trim(),
      schedule: editing.schedule || "every 1h",
      prompt: editing.prompt || "",
      status: editing.status || "active",
      script: editing.script?.trim(),
      scriptContent: editing.scriptContent,
      noAgent: Boolean(editing.noAgent),
      deliver: editing.deliver?.trim(),
      workdir: editing.workdir?.trim(),
      skills: editing.skills,
    };
    try {
      await window.workbenchClient.saveCronJob(job);
      setEditing(undefined);
      setMessage("任务已保存到 Hermes 原生定时任务。");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存定时任务失败。");
    }
  }
}

function actionLabel(action: "delete" | "pause" | "resume" | "run") {
  return ({ delete: "删除", pause: "暂停", resume: "恢复", run: "运行" } as const)[action];
}

function confirmBody(action: "delete" | "pause" | "resume" | "run") {
  if (action === "delete") return "这会调用 Hermes CLI 删除该 cron 任务，任务配置可能无法恢复。";
  if (action === "run") return "将立即触发该任务，请确认当前 Agent、工作区和密钥配置正确。";
  if (action === "pause") return "暂停后任务不会继续按计划运行，之后可以在这里恢复。";
  return "恢复后任务会重新按计划运行。";
}
