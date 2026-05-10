import { Save } from "lucide-react";
import type { HermesCronJob } from "../../../shared/types";
import { cn } from "../DashboardPrimitives";

export function CronEditor(props: { value: Partial<HermesCronJob>; onChange: (value: Partial<HermesCronJob>) => void; onCancel: () => void; onSave: () => void }) {
  const schedule = scheduleParts(props.value.schedule ?? "every 1h");
  const setSchedule = (next: string) => props.onChange({ ...props.value, schedule: next });
  const isNoAgent = Boolean(props.value.noAgent);
  const hasScript = Boolean(props.value.script?.trim() || props.value.scriptContent?.trim());
  const saveDisabled = !props.value.name?.trim()
    || !props.value.schedule?.trim()
    || (isNoAgent ? !hasScript : !props.value.prompt?.trim());

  return (
    <section className={editorPanelClass}>
      <div className="mb-2 grid gap-2 sm:grid-cols-2">
        <button
          className={cn(modeButtonClass, !isNoAgent && "bg-indigo-600 text-white ring-indigo-600")}
          onClick={() => props.onChange({ ...props.value, noAgent: false })}
          type="button"
        >
          Agent 任务
        </button>
        <button
          className={cn(modeButtonClass, isNoAgent && "bg-indigo-600 text-white ring-indigo-600")}
          onClick={() => props.onChange({ ...props.value, noAgent: true })}
          type="button"
        >
          脚本看门狗
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <TextInput label="名称" value={props.value.name ?? ""} onChange={(name) => props.onChange({ ...props.value, name })} />
        <label className="grid gap-1 text-[12px] font-medium text-slate-500">
          计划类型
          <select
            className={inputClass}
            value={schedule.mode}
            onChange={(event) => {
              const mode = event.target.value as ScheduleMode;
              setSchedule(mode === "interval" ? "every 1h" : mode === "cron" ? "0 9 * * *" : new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));
            }}
          >
            <option value="interval">每隔一段时间</option>
            <option value="cron">Cron 表达式</option>
            <option value="once">指定时间运行一次</option>
          </select>
        </label>
      </div>

      {schedule.mode === "interval" ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_160px]">
          <NumberInput label="间隔" value={schedule.amount} onChange={(amount) => setSchedule(`every ${Math.max(1, amount)}${schedule.unit}`)} />
          <label className="grid gap-1 text-[12px] font-medium text-slate-500">
            单位
            <select className={inputClass} value={schedule.unit} onChange={(event) => setSchedule(`every ${schedule.amount}${event.target.value}`)}>
              <option value="m">分钟</option>
              <option value="h">小时</option>
              <option value="d">天</option>
            </select>
          </label>
        </div>
      ) : schedule.mode === "cron" ? (
        <TextInput label="Cron 表达式" value={props.value.schedule ?? ""} placeholder="0 9 * * *" onChange={setSchedule} />
      ) : (
        <label className="mt-2 grid gap-1 text-[12px] font-medium text-slate-500">
          运行时间
          <input className={inputClass} type="datetime-local" value={toDatetimeLocal(props.value.schedule)} onChange={(event) => setSchedule(event.target.value)} />
        </label>
      )}

      {!isNoAgent ? (
        <textarea className={cn("mt-2 h-28", textareaClass)} placeholder="写清楚这次定时任务要让 Hermes Agent 做什么" value={props.value.prompt ?? ""} onChange={(event) => props.onChange({ ...props.value, prompt: event.target.value })} />
      ) : (
        <textarea className={cn("mt-2 h-20", textareaClass)} placeholder="可选：备注这个看门狗要检查什么；Hermes 不会启动 Agent" value={props.value.prompt ?? ""} onChange={(event) => props.onChange({ ...props.value, prompt: event.target.value })} />
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <TextInput label={isNoAgent ? "脚本文件名" : "预运行脚本文件名"} value={props.value.script ?? ""} placeholder={isNoAgent ? "watchdog.py" : "collect_context.py"} onChange={(script) => props.onChange({ ...props.value, script })} />
        <TextInput label="工作目录" value={props.value.workdir ?? ""} placeholder="可选，留空使用 Hermes 默认目录" onChange={(workdir) => props.onChange({ ...props.value, workdir })} />
      </div>
      <textarea
        className={cn("mt-2 h-32", textareaClass)}
        placeholder={isNoAgent ? "脚本内容必填，例如：print('FORGE_CRON_NO_AGENT_OK')" : "可选：在 Agent prompt 前运行的数据采集脚本"}
        value={props.value.scriptContent ?? ""}
        onChange={(event) => props.onChange({ ...props.value, scriptContent: event.target.value })}
      />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <TextInput label="Deliver" value={props.value.deliver ?? ""} placeholder="local, stdout, telegram..." onChange={(deliver) => props.onChange({ ...props.value, deliver })} />
        <TextInput
          label="Skills"
          value={(props.value.skills ?? []).join(", ")}
          placeholder="skill-a, skill-b"
          onChange={(skills) => props.onChange({ ...props.value, skills: skills.split(",").map((item) => item.trim()).filter(Boolean) })}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[12px] text-slate-600">
          <input type="checkbox" checked={props.value.status !== "paused"} onChange={(event) => props.onChange({ ...props.value, status: event.target.checked ? "active" : "paused" })} />
          启用任务
        </label>
        <FormActions onCancel={props.onCancel} onSave={props.onSave} disabled={saveDisabled} />
      </div>
    </section>
  );
}

type ScheduleMode = "interval" | "cron" | "once";

const editorPanelClass = "rounded-lg bg-[#f9f9fa] p-4";
const inputClass = "rounded-md bg-white px-3 py-2 text-[13px] font-normal text-slate-800 outline-none ring-1 ring-slate-100 transition-shadow focus:ring-2 focus:ring-indigo-100";
const textareaClass = "w-full rounded-md bg-white p-3 text-[13px] outline-none ring-1 ring-slate-100 transition-shadow focus:ring-2 focus:ring-indigo-100";
const modeButtonClass = "rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 ring-1 ring-slate-100 transition-colors hover:bg-slate-50";

function TextInput(props: { label: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-2 grid gap-1 text-[12px] font-medium text-slate-500">
      {props.label}
      <input className={inputClass} placeholder={props.placeholder} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

function NumberInput(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-[12px] font-medium text-slate-500">
      {props.label}
      <input className={inputClass} min={1} step={1} type="number" value={props.value} onChange={(event) => props.onChange(Number(event.target.value) || 1)} />
    </label>
  );
}

function FormActions(props: { onCancel: () => void; onSave: () => void; disabled?: boolean }) {
  return (
    <div className="flex gap-2">
      <button className={secondaryActionClass} onClick={props.onCancel} type="button">取消</button>
      <button className={primaryActionClass} disabled={props.disabled} onClick={props.onSave} type="button">
        <Save size={13} /> 保存
      </button>
    </div>
  );
}

const primaryActionClass = "inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryActionClass = "rounded-md px-3 py-1.5 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100";

function scheduleParts(raw: string): { mode: ScheduleMode; amount: number; unit: "m" | "h" | "d" } {
  const value = raw.trim();
  const interval = value.match(/^every\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i)
    ?? value.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (interval) {
    return { mode: "interval", amount: Number(interval[1]) || 1, unit: normalizeUnit(interval[2]) };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return { mode: "once", amount: 1, unit: "h" };
  }
  return { mode: "cron", amount: 1, unit: "h" };
}

function normalizeUnit(value: string): "m" | "h" | "d" {
  const unit = value.toLowerCase();
  if (unit.startsWith("h")) return "h";
  if (unit.startsWith("d")) return "d";
  return "m";
}

function toDatetimeLocal(value: string | undefined) {
  if (!value) return "";
  return value.replace("Z", "").slice(0, 16);
}
