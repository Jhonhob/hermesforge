import { Bot, CalendarClock, ChevronDown, Save, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { HermesCronJob } from "../../../shared/types";
import { cn } from "../DashboardPrimitives";

type TriggerKind = "daily" | "weekly" | "monthly" | "interval" | "once" | "advanced";
type IntervalUnit = "m" | "h" | "d";

type TriggerForm = {
  kind: TriggerKind;
  time: string;
  weekday: string;
  monthDay: string;
  intervalAmount: string;
  intervalUnit: IntervalUnit;
  onceAt: string;
  advancedSchedule: string;
};

const triggerTabs: Array<{ kind: TriggerKind; label: string }> = [
  { kind: "daily", label: "每天" },
  { kind: "weekly", label: "每周" },
  { kind: "monthly", label: "每月" },
  { kind: "interval", label: "间隔" },
  { kind: "once", label: "一次" },
];

const weekdays = [
  { label: "周一", value: "1" },
  { label: "周二", value: "2" },
  { label: "周三", value: "3" },
  { label: "周四", value: "4" },
  { label: "周五", value: "5" },
  { label: "周六", value: "6" },
  { label: "周日", value: "0" },
];

const intervalUnits: Array<{ label: string; value: IntervalUnit }> = [
  { label: "分钟", value: "m" },
  { label: "小时", value: "h" },
  { label: "天", value: "d" },
];

export function CronEditor(props: { value: Partial<HermesCronJob>; onChange: (value: Partial<HermesCronJob>) => void; onCancel: () => void; onSave: () => void }) {
  const isNoAgent = Boolean(props.value.noAgent);
  const hasScript = Boolean(props.value.script?.trim() || props.value.scriptContent?.trim());
  const [trigger, setTrigger] = useState(() => parseTrigger(props.value.schedule));
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(props.value.workdir || props.value.deliver || props.value.skills?.length || props.value.script || props.value.scriptContent || trigger.kind === "advanced"),
  );
  const saveDisabled = !props.value.name?.trim()
    || !props.value.schedule?.trim()
    || (isNoAgent ? !hasScript : !props.value.prompt?.trim());
  const scheduleHint = useMemo(() => schedulePreview(trigger), [trigger]);

  useEffect(() => {
    const next = parseTrigger(props.value.schedule);
    setTrigger(next);
    setAdvancedOpen(Boolean(props.value.workdir || props.value.deliver || props.value.skills?.length || props.value.script || props.value.scriptContent || next.kind === "advanced"));
  }, [props.value.id]);

  const update = (patch: Partial<HermesCronJob>) => props.onChange({ ...props.value, ...patch });
  const updateTrigger = (patch: Partial<TriggerForm>) => {
    const next: TriggerForm = { ...trigger, ...patch };
    if (patch.kind === "once" && !next.onceAt) {
      next.onceAt = defaultOnceAt();
    }
    setTrigger(next);
    update({ schedule: scheduleFromTrigger(next) });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-white">
            <CalendarClock size={16} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-950">{props.value.id ? "编辑任务" : "新建任务"}</h3>
            <p className="mt-0.5 text-xs text-slate-400">{scheduleHint || "设置触发时间"}</p>
          </div>
        </div>
        <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={props.onCancel} title="关闭" type="button">
          <X size={15} />
        </button>
      </div>

      <div className="grid gap-5 p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <TextInput label="任务名称" value={props.value.name ?? ""} placeholder="早间简报" onChange={(name) => update({ name })} />
          <SwitchControl checked={props.value.status !== "paused"} label="启用" onChange={(checked) => update({ status: checked ? "active" : "paused" })} />
        </div>

        <div className="grid gap-2">
          <span className="text-[12px] font-medium text-slate-500">执行方式</span>
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            <ModeButton active={!isNoAgent} icon={Bot} label="Agent" onClick={() => update({ noAgent: false })} />
            <ModeButton active={isNoAgent} icon={Terminal} label="脚本" onClick={() => update({ noAgent: true })} />
          </div>
        </div>

        <label className={labelClass}>
          {isNoAgent ? "备注" : "提示词"}
          <textarea
            className={cn(textareaClass, "h-28")}
            placeholder={isNoAgent ? "备注这个脚本任务要检查什么" : "写清楚 Hermes Agent 到点后要做什么"}
            value={props.value.prompt ?? ""}
            onChange={(event) => update({ prompt: event.target.value })}
          />
        </label>

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-slate-500">触发时间</span>
            <span className="truncate text-[12px] text-slate-400">{scheduleHint}</span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex flex-wrap gap-2">
              {triggerTabs.map((tab) => (
                <button
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition",
                    trigger.kind === tab.kind ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                  )}
                  key={tab.kind}
                  onClick={() => updateTrigger({ kind: tab.kind })}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <TriggerFields trigger={trigger} onChange={updateTrigger} />
          </div>
        </div>

        {isNoAgent ? (
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <TextInput label="脚本文件名" value={props.value.script ?? ""} placeholder="watchdog.py" onChange={(script) => update({ script })} />
            <label className={labelClass}>
              脚本内容
              <textarea
                className={cn(textareaClass, "h-28 font-mono")}
                placeholder="print('FORGE_CRON_NO_AGENT_OK')"
                value={props.value.scriptContent ?? ""}
                onChange={(event) => update({ scriptContent: event.target.value })}
              />
            </label>
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-200">
          <button
            className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] font-semibold text-slate-700"
            onClick={() => setAdvancedOpen((open) => !open)}
            type="button"
          >
            高级选项
            <ChevronDown size={14} className={cn("transition-transform", advancedOpen && "rotate-180")} />
          </button>
          {advancedOpen ? (
            <div className="grid gap-3 border-t border-slate-100 p-3">
              {trigger.kind === "advanced" ? (
                <TextInput label="兼容旧任务表达式" value={trigger.advancedSchedule} placeholder="0 9 * * *" onChange={(advancedSchedule) => updateTrigger({ advancedSchedule })} />
              ) : null}
              {!isNoAgent ? (
                <>
                  <TextInput label="预运行脚本文件名" value={props.value.script ?? ""} placeholder="collect_context.py" onChange={(script) => update({ script })} />
                  <label className={labelClass}>
                    预运行脚本内容
                    <textarea className={cn(textareaClass, "h-24 font-mono")} value={props.value.scriptContent ?? ""} onChange={(event) => update({ scriptContent: event.target.value })} />
                  </label>
                </>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput label="工作目录" value={props.value.workdir ?? ""} placeholder="可选" onChange={(workdir) => update({ workdir })} />
                <TextInput label="Deliver" value={props.value.deliver ?? ""} placeholder="local, stdout..." onChange={(deliver) => update({ deliver })} />
              </div>
              <TextInput
                label="Skills"
                value={(props.value.skills ?? []).join(", ")}
                placeholder="skill-a, skill-b"
                onChange={(skills) => update({ skills: skills.split(",").map((item) => item.trim()).filter(Boolean) })}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
        <button className="rounded-lg px-4 py-2 text-[13px] font-medium text-slate-500 hover:bg-white" onClick={props.onCancel} type="button">
          取消
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={saveDisabled}
          onClick={props.onSave}
          type="button"
        >
          <Save size={14} />
          保存
        </button>
      </div>
    </section>
  );
}

function TriggerFields(props: { trigger: TriggerForm; onChange: (patch: Partial<TriggerForm>) => void }) {
  const { trigger } = props;
  if (trigger.kind === "weekly") {
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
        <ChoiceGroup label="每周" value={trigger.weekday} options={weekdays} onChange={(weekday) => props.onChange({ weekday })} />
        <TimeInput label="触发时刻" value={trigger.time} onChange={(time) => props.onChange({ time })} />
      </div>
    );
  }
  if (trigger.kind === "monthly") {
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
        <TextInput label="每月几号" type="number" min={1} max={31} value={trigger.monthDay} onChange={(monthDay) => props.onChange({ monthDay })} />
        <TimeInput label="触发时刻" value={trigger.time} onChange={(time) => props.onChange({ time })} />
      </div>
    );
  }
  if (trigger.kind === "interval") {
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
        <TextInput label="每隔" type="number" min={1} value={trigger.intervalAmount} onChange={(intervalAmount) => props.onChange({ intervalAmount })} />
        <ChoiceGroup label="单位" value={trigger.intervalUnit} options={intervalUnits} onChange={(intervalUnit) => props.onChange({ intervalUnit: intervalUnit as IntervalUnit })} />
      </div>
    );
  }
  if (trigger.kind === "once") {
    return (
      <div className="mt-3">
        <DateTimeInput value={trigger.onceAt} onChange={(onceAt) => props.onChange({ onceAt })} />
      </div>
    );
  }
  if (trigger.kind === "advanced") {
    return <p className="mt-3 rounded-lg bg-white px-3 py-2 text-[12px] text-slate-500 ring-1 ring-slate-200">这个任务使用了旧版表达式，已放到高级选项里保留。</p>;
  }
  return (
    <div className="mt-3">
      <TimeInput label="触发时刻" value={trigger.time} onChange={(time) => props.onChange({ time })} />
    </div>
  );
}

const labelClass = "grid gap-1.5 text-[12px] font-medium text-slate-500";
const inputClass = "rounded-lg bg-white px-3 py-2 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200 transition-shadow focus:ring-2 focus:ring-slate-300";
const timeInputClass = "h-10 min-w-0 rounded-lg bg-slate-50 px-2 text-center text-base font-semibold text-slate-900 outline-none ring-1 ring-slate-200 transition focus:bg-white focus:ring-2 focus:ring-slate-300";
const textareaClass = "w-full rounded-lg bg-white p-3 text-[13px] leading-relaxed outline-none ring-1 ring-slate-200 transition-shadow focus:ring-2 focus:ring-slate-300";

function ModeButton(props: { active: boolean; icon: typeof Bot; label: string; onClick: () => void }) {
  const Icon = props.icon;
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold ring-1 transition",
        props.active ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
      )}
      onClick={props.onClick}
      type="button"
    >
      <Icon size={14} />
      {props.label}
    </button>
  );
}

function TextInput(props: { label: string; value: string; placeholder?: string; type?: string; min?: number; max?: number; onChange: (value: string) => void }) {
  return (
    <label className={labelClass}>
      {props.label}
      <input
        className={inputClass}
        max={props.max}
        min={props.min}
        placeholder={props.placeholder}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function ChoiceGroup(props: { label: string; value: string; options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) {
  return (
    <label className={labelClass}>
      {props.label}
      <span className="flex flex-wrap gap-1.5">
        {props.options.map((option) => (
          <button
            className={cn(
              "rounded-lg px-2.5 py-2 text-[12px] font-semibold ring-1 transition",
              props.value === option.value ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
            )}
            key={option.value}
            onClick={() => props.onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </span>
    </label>
  );
}

function SwitchControl(props: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      aria-pressed={props.checked}
      className="flex items-end gap-2 pb-1 text-[13px] font-medium text-slate-600"
      onClick={() => props.onChange(!props.checked)}
      type="button"
    >
      <span className={cn("relative mb-0.5 h-5 w-9 rounded-full transition", props.checked ? "bg-slate-950" : "bg-slate-200")}>
        <span className={cn("absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm transition", props.checked ? "left-5" : "left-1")} />
      </span>
      {props.label}
    </button>
  );
}

function TimeInput(props: { label: string; value: string; onChange: (value: string) => void }) {
  const { hour, minute } = parseTime(props.value);
  const setPart = (part: "hour" | "minute", value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 2);
    const nextHour = part === "hour" ? clamp(positiveInt(digits, 0), 0, 23) : hour;
    const nextMinute = part === "minute" ? clamp(positiveInt(digits, 0), 0, 59) : minute;
    props.onChange(formatTime(nextHour, nextMinute));
  };

  return (
    <label className={labelClass}>
      {props.label}
      <span className="rounded-xl bg-white p-2 ring-1 ring-slate-200">
        <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <input
            aria-label={`${props.label}小时`}
            className={timeInputClass}
            inputMode="numeric"
            maxLength={2}
            value={String(hour).padStart(2, "0")}
            onChange={(event) => setPart("hour", event.target.value)}
          />
          <span className="text-base font-semibold text-slate-300">:</span>
          <input
            aria-label={`${props.label}分钟`}
            className={timeInputClass}
            inputMode="numeric"
            maxLength={2}
            value={String(minute).padStart(2, "0")}
            onChange={(event) => setPart("minute", event.target.value)}
          />
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          {["09:00", "12:00", "18:00", "21:00"].map((time) => (
            <button
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition",
                props.value === time ? "bg-slate-950 text-white ring-slate-950" : "bg-slate-50 text-slate-500 ring-slate-200 hover:bg-white",
              )}
              key={time}
              onClick={() => props.onChange(time)}
              type="button"
            >
              {time}
            </button>
          ))}
        </span>
      </span>
    </label>
  );
}

function DateTimeInput(props: { value: string; onChange: (value: string) => void }) {
  const date = datePart(props.value);
  const time = timePart(props.value);
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
      <TextInput label="触发日期" placeholder="2026-05-18" value={date} onChange={(nextDate) => props.onChange(combineDateTime(nextDate, time))} />
      <TimeInput label="触发时刻" value={time} onChange={(nextTime) => props.onChange(combineDateTime(date, nextTime))} />
    </div>
  );
}

function parseTrigger(value: string | undefined): TriggerForm {
  const fallback = defaultTrigger(value);
  const trimmed = value?.trim();
  if (!trimmed) return fallback;

  const interval = trimmed.match(/^(?:every\s+)?(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (interval) {
    return { ...fallback, kind: "interval", intervalAmount: interval[1], intervalUnit: normalizeIntervalUnit(interval[2]) };
  }

  const once = trimmed.match(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (once) {
    return { ...fallback, kind: "once", onceAt: toDateTimeInput(trimmed) };
  }

  const daily = trimmed.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (daily) {
    return { ...fallback, kind: "daily", time: toTime(daily[2], daily[1]) };
  }

  const weekly = trimmed.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\d{1,2})$/);
  if (weekly) {
    return { ...fallback, kind: "weekly", time: toTime(weekly[2], weekly[1]), weekday: weekly[3] };
  }

  const monthly = trimmed.match(/^(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+\*\s+\*$/);
  if (monthly) {
    return { ...fallback, kind: "monthly", time: toTime(monthly[2], monthly[1]), monthDay: monthly[3] };
  }

  return { ...fallback, kind: "advanced", advancedSchedule: trimmed };
}

function defaultTrigger(schedule = "0 9 * * *"): TriggerForm {
  return {
    kind: "daily",
    time: "09:00",
    weekday: "1",
    monthDay: "1",
    intervalAmount: "1",
    intervalUnit: "h",
    onceAt: "",
    advancedSchedule: schedule,
  };
}

function scheduleFromTrigger(trigger: TriggerForm) {
  if (trigger.kind === "interval") {
    return `every ${positiveInt(trigger.intervalAmount, 1)}${trigger.intervalUnit}`;
  }
  if (trigger.kind === "once") {
    return trigger.onceAt;
  }
  if (trigger.kind === "advanced") {
    return trigger.advancedSchedule;
  }
  const { hour, minute } = parseTime(trigger.time);
  if (trigger.kind === "weekly") {
    return `${minute} ${hour} * * ${trigger.weekday}`;
  }
  if (trigger.kind === "monthly") {
    return `${minute} ${hour} ${clamp(positiveInt(trigger.monthDay, 1), 1, 31)} * *`;
  }
  return `${minute} ${hour} * * *`;
}

function schedulePreview(trigger: TriggerForm) {
  if (trigger.kind === "interval") {
    return `每 ${positiveInt(trigger.intervalAmount, 1)} ${intervalUnits.find((unit) => unit.value === trigger.intervalUnit)?.label ?? "小时"}触发`;
  }
  if (trigger.kind === "once") {
    return trigger.onceAt ? `${trigger.onceAt.replace("T", " ")} 触发一次` : "选择一次性触发时间";
  }
  if (trigger.kind === "advanced") {
    return trigger.advancedSchedule || "旧版表达式";
  }
  if (trigger.kind === "weekly") {
    const weekday = weekdays.find((item) => item.value === trigger.weekday)?.label ?? "周一";
    return `每${weekday} ${trigger.time} 触发`;
  }
  if (trigger.kind === "monthly") {
    return `每月 ${clamp(positiveInt(trigger.monthDay, 1), 1, 31)} 号 ${trigger.time} 触发`;
  }
  return `每天 ${trigger.time} 触发`;
}

function normalizeIntervalUnit(unit: string): IntervalUnit {
  const lower = unit.toLowerCase();
  if (lower.startsWith("m")) return "m";
  if (lower.startsWith("d")) return "d";
  return "h";
}

function toTime(hour: string, minute: string) {
  return formatTime(clamp(positiveInt(hour, 9), 0, 23), clamp(positiveInt(minute, 0), 0, 59));
}

function parseTime(value: string) {
  const [hour = "9", minute = "0"] = value.split(":");
  return {
    hour: clamp(positiveInt(hour, 9), 0, 23),
    minute: clamp(positiveInt(minute, 0), 0, 59),
  };
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function toDateTimeInput(value: string) {
  return value.replace(" ", "T").replace(/(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/, "").slice(0, 16);
}

function datePart(value: string) {
  return value.slice(0, 10) || defaultOnceAt().slice(0, 10);
}

function timePart(value: string) {
  const match = value.match(/[ T](\d{2}:\d{2})/);
  return match?.[1] ?? "09:00";
}

function combineDateTime(date: string, time: string) {
  return `${date.slice(0, 10)}T${time}`;
}

function defaultOnceAt() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function positiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
