import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronRight,
  Columns3,
  Gauge,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  HermesGatewayStatus,
  HermesKanbanAssignee,
  HermesKanbanBoard,
  HermesKanbanDiagnostic,
  HermesKanbanTask,
  HermesKanbanTaskAction,
} from "../../../../shared/types";
import { cn, NativeBadge, NativeButton } from "../../DashboardPrimitives";

/** 看板列定义 - 小白友好的中文标签和说明 */
const columns = [
  { id: "triage", label: "待分类", help: "新想法，还没确定具体要做什么" },
  { id: "todo", label: "待处理", help: "已确认需求，等待分配或依赖完成" },
  { id: "ready", label: "就绪", help: "已分配负责人，等待系统调度执行" },
  { id: "running", label: "执行中", help: "AI 正在处理这个任务" },
  { id: "blocked", label: "已阻塞", help: "需要人工介入才能继续" },
  { id: "done", label: "已完成", help: "任务已结束" },
] as const;

/** 状态 → 中文显示名 */
const statusName: Record<string, string> = {
  triage: "待分类",
  todo: "待处理",
  ready: "就绪",
  running: "执行中",
  blocked: "已阻塞",
  done: "已完成",
  archived: "已归档",
};

type ColumnId = (typeof columns)[number]["id"];

export function KanbanPanel() {
  const [boards, setBoards] = useState<HermesKanbanBoard[]>([]);
  const [activeBoard, setActiveBoard] = useState("");
  const [tasks, setTasks] = useState<HermesKanbanTask[]>([]);
  const [diagnostics, setDiagnostics] = useState<HermesKanbanDiagnostic[]>([]);
  const [assignees, setAssignees] = useState<HermesKanbanAssignee[]>([]);
  const [gateway, setGateway] = useState<HermesGatewayStatus | null>(null);
  const [selectedTask, setSelectedTask] = useState<HermesKanbanTask | null>(null);
  const [taskLog, setTaskLog] = useState("");
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [laneByProfile, setLaneByProfile] = useState(true);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [newBoardSlug, setNewBoardSlug] = useState("");
  const [newBoardName, setNewBoardName] = useState("");
  const [showRenameBoard, setShowRenameBoard] = useState(false);
  const [renameBoardName, setRenameBoardName] = useState("");
  const [newTaskColumn, setNewTaskColumn] = useState<ColumnId>("todo");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskBody, setNewTaskBody] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("");
  const [blockReasonById, setBlockReasonById] = useState<Record<string, string>>({});
  const [assignById, setAssignById] = useState<Record<string, string>>({});
  const [editResultById, setEditResultById] = useState<Record<string, string>>({});
  const [editSummaryById, setEditSummaryById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  const currentBoard = useMemo(
    () => boards.find((board) => board.slug === activeBoard) ?? boards.find((board) => board.is_current) ?? boards[0],
    [activeBoard, boards],
  );

  const diagnosticsByTask = useMemo(() => {
    const map = new Map<string, HermesKanbanDiagnostic[]>();
    for (const item of diagnostics) {
      const id = item.task_id;
      if (!id) continue;
      map.set(id, [...(map.get(id) ?? []), item]);
    }
    return map;
  }, [diagnostics]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (!includeArchived && task.status === "archived") return false;
      if (assigneeFilter && task.assignee !== assigneeFilter) return false;
      if (!q) return true;
      return `${task.id} ${task.title} ${task.assignee ?? ""} ${task.tenant ?? ""} ${task.body ?? ""}`.toLowerCase().includes(q);
    });
  }, [assigneeFilter, includeArchived, search, tasks]);

  const taskGroups = useMemo(() => {
    const grouped = new Map<string, HermesKanbanTask[]>();
    for (const column of columns) grouped.set(column.id, []);
    for (const task of filteredTasks) {
      const key = columns.some((column) => column.id === task.status) ? String(task.status) : "todo";
      grouped.set(key, [...(grouped.get(key) ?? []), task]);
    }
    return grouped;
  }, [filteredTasks]);

  const stats = useMemo(() => {
    const counts = columns.reduce<Record<string, number>>((acc, column) => {
      acc[column.id] = taskGroups.get(column.id)?.length ?? 0;
      return acc;
    }, {});
    return {
      total: filteredTasks.length,
      ready: counts.ready ?? 0,
      running: counts.running ?? 0,
      blocked: counts.blocked ?? 0,
      diagnostics: diagnostics.reduce((sum, item) => sum + Math.max(1, item.diagnostics?.length ?? 0), 0),
      counts,
    };
  }, [diagnostics, filteredTasks.length, taskGroups]);

  async function refresh(boardSlug = activeBoard) {
    if (!window.workbenchClient) return;
    setBusy(true);
    setError("");
    try {
      const [boardList, gatewayStatus] = await Promise.all([
        window.workbenchClient.listKanbanBoards(),
        window.workbenchClient.getGatewayStatus().catch(() => null),
      ]);
      const nextBoard = boardSlug || boardList.find((board) => board.is_current)?.slug || boardList[0]?.slug || "";
      setBoards(boardList);
      setActiveBoard(nextBoard);
      setGateway(gatewayStatus);
      const [nextTasks, nextDiagnostics, nextAssignees] = await Promise.all([
        nextBoard ? window.workbenchClient.listKanbanTasks({ board: nextBoard, archived: includeArchived }) : Promise.resolve([]),
        nextBoard ? window.workbenchClient.listKanbanDiagnostics({ board: nextBoard }).catch(() => []) : Promise.resolve([]),
        nextBoard ? window.workbenchClient.listKanbanAssignees(nextBoard).catch(() => []) : Promise.resolve([]),
      ]);
      setTasks(nextTasks);
      setDiagnostics(nextDiagnostics);
      setAssignees(nextAssignees);
    } catch (err) {
      setError(err instanceof Error ? err.message : "看板加载失败，请刷新重试。");
    } finally {
      setBusy(false);
    }
  }

  async function createBoard() {
    if (!newBoardSlug.trim()) return;
    const slug = newBoardSlug.trim();
    await runAction(async () => {
      await window.workbenchClient.createKanbanBoard({ slug, name: newBoardName.trim() || undefined, switchTo: true });
      setNewBoardSlug("");
      setNewBoardName("");
      setShowCreateBoard(false);
      await refresh(slug);
    }, "看板创建成功");
  }

  async function switchBoard(slug: string) {
    await runAction(async () => {
      await window.workbenchClient.switchKanbanBoard(slug);
      setSelectedTask(null);
      await refresh(slug);
    }, "已切换到新看板");
  }

  async function deleteBoard(slug: string) {
    if (!window.confirm(`确定要永久删除看板 "${slug}" 吗？此操作不可恢复。`)) return;
    await runAction(async () => {
      await window.workbenchClient.deleteKanbanBoard(slug);
      await refresh();
    }, "看板已删除");
  }

  async function renameBoard() {
    if (!currentBoard || !renameBoardName.trim()) return;
    await runAction(async () => {
      await window.workbenchClient.renameKanbanBoard({ slug: currentBoard.slug, name: renameBoardName.trim() });
      setRenameBoardName("");
      setShowRenameBoard(false);
      await refresh(currentBoard.slug);
    }, "看板重命名成功");
  }

  async function dispatchBoard() {
    if (!currentBoard) return;
    await runAction(async () => {
      await window.workbenchClient.dispatchKanban(currentBoard.slug);
      await refresh(currentBoard.slug);
    }, "已触发任务调度");
  }

  async function createTask(column: ColumnId = newTaskColumn) {
    if (!newTaskTitle.trim() || !currentBoard) return;
    await runAction(async () => {
      const task = await window.workbenchClient.createKanbanTask({
        board: currentBoard.slug,
        title: newTaskTitle.trim(),
        body: newTaskBody.trim() || undefined,
        assignee: newTaskAssignee.trim() || undefined,
        priority: newTaskPriority.trim() || undefined,
        triage: column === "triage",
      });
      if (column === "ready" && task.status !== "ready") {
        await window.workbenchClient.runKanbanTaskAction({ board: currentBoard.slug, taskId: task.id, action: "unblock" }).catch(() => undefined);
      }
      setNewTaskTitle("");
      setNewTaskBody("");
      setNewTaskPriority("");
      await refresh(currentBoard.slug);
    }, "任务创建成功");
  }

  async function runTaskAction(task: HermesKanbanTask, action: HermesKanbanTaskAction) {
    if (!currentBoard) return;
    const reason = action === "block" ? blockReasonById[task.id]?.trim() || "从前端看板手动阻塞" : undefined;
    const assignee = action === "assign" || action === "reassign" ? assignById[task.id]?.trim() || newTaskAssignee.trim() : undefined;
    const result = action === "edit" ? editResultById[task.id]?.trim() : action === "complete" ? "从前端看板标记完成" : undefined;
    const summary = action === "edit" ? editSummaryById[task.id]?.trim() || undefined : undefined;
    if (action === "edit" && !result) {
      setError("编辑结果时，需要填写新的结果内容。");
      return;
    }
    await runAction(async () => {
      await window.workbenchClient.runKanbanTaskAction({
        board: currentBoard.slug,
        taskId: task.id,
        action,
        reason,
        assignee,
        result,
        summary,
        reclaim: action === "reassign",
      });
      setBlockReasonById((current) => ({ ...current, [task.id]: "" }));
      setEditResultById((current) => ({ ...current, [task.id]: "" }));
      setEditSummaryById((current) => ({ ...current, [task.id]: "" }));
      await refresh(currentBoard.slug);
    }, "操作成功");
  }

  async function openTask(task: HermesKanbanTask) {
    if (!currentBoard) return;
    await runAction(async () => {
      const detail = await window.workbenchClient.getKanbanTask({ board: currentBoard.slug, taskId: task.id });
      setSelectedTask(detail);
      const log = await window.workbenchClient.readKanbanTaskLog({ board: currentBoard.slug, taskId: task.id, tail: 500 }).catch(() => ({ message: "" }));
      setTaskLog(log.message);
    }, "");
  }

  async function runAction(fn: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (success) setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {/* 顶部看板信息栏 */}
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-white">
              <Columns3 size={18} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-950">任务看板</h3>
                {gateway?.running ? (
                  <NativeBadge tone="green" label="调度器运行中" pulse />
                ) : (
                  <NativeBadge tone="amber" label="调度器未启动" />
                )}
              </div>
              <p className="truncate text-xs text-slate-500">多智能体协作任务板 — 由 Hermes CLI 驱动</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={selectClass}
              value={currentBoard?.slug ?? ""}
              onChange={(event) => void switchBoard(event.target.value)}
              title="切换看板"
            >
              {boards.map((board) => (
                <option key={board.slug} value={board.slug}>
                  {board.name || board.slug}
                </option>
              ))}
            </select>
            <NativeButton size="sm" variant="secondary" onClick={() => setShowCreateBoard((value) => !value)}>
              <Plus size={13} /> 新建看板
            </NativeButton>
            {currentBoard ? (
              <NativeButton size="sm" variant="secondary" onClick={() => { setShowRenameBoard((v) => !v); setRenameBoardName(currentBoard.name || ""); }}>
                重命名
              </NativeButton>
            ) : null}
            {currentBoard && currentBoard.slug !== "default" ? (
              <NativeButton size="sm" variant="secondary" onClick={() => void deleteBoard(currentBoard.slug)}>
                删除
              </NativeButton>
            ) : null}
            {gateway?.running ? (
              <NativeButton size="sm" variant="secondary" onClick={() => void dispatchBoard()}>
                立即调度
              </NativeButton>
            ) : (
              <NativeButton
                size="sm"
                variant="secondary"
                onClick={() =>
                  void runAction(async () => {
                    await window.workbenchClient.startGateway();
                    await refresh(currentBoard?.slug);
                  }, "Gateway 启动成功")
                }
              >
                <Zap size={13} /> 启动调度器
              </NativeButton>
            )}
            <NativeButton size="sm" variant="ghost" onClick={() => void refresh(currentBoard?.slug)}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} 刷新
            </NativeButton>
          </div>
        </div>

        {/* 新建看板输入框 */}
        {showCreateBoard ? (
          <div className="grid gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:grid-cols-[180px_1fr_auto]">
            <input className={inputClass} placeholder="看板标识（如：project-a）" value={newBoardSlug} onChange={(event) => setNewBoardSlug(event.target.value)} />
            <input className={inputClass} placeholder="看板显示名称" value={newBoardName} onChange={(event) => setNewBoardName(event.target.value)} />
            <NativeButton size="sm" onClick={() => void createBoard()}>
              <Plus size={13} /> 创建
            </NativeButton>
          </div>
        ) : null}

        {/* 重命名看板输入框 */}
        {showRenameBoard && currentBoard ? (
          <div className="grid gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:grid-cols-[1fr_auto]">
            <input className={inputClass} placeholder="新的看板名称" value={renameBoardName} onChange={(event) => setRenameBoardName(event.target.value)} />
            <NativeButton size="sm" onClick={() => void renameBoard()}>确认重命名</NativeButton>
          </div>
        ) : null}

        {/* 统计卡片 */}
        <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="全部任务" value={stats.total} icon={<Gauge size={13} />} />
          <Metric label="就绪" value={stats.ready} tone="amber" />
          <Metric label="执行中" value={stats.running} tone="green" />
          <Metric label="已阻塞" value={stats.blocked} tone="red" />
          <Metric label="诊断告警" value={stats.diagnostics} tone={stats.diagnostics ? "red" : "slate"} />
        </div>
      </section>

      {/* 调度器未运行提示 */}
      {!gateway?.running ? (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            调度器未运行，"就绪" 列的任务不会自动被 AI 执行。您可以继续创建和整理任务，或点击上方"启动调度器"按钮。
          </span>
        </div>
      ) : null}

      {/* 诊断告警条 */}
      <AttentionStrip diagnostics={diagnostics} tasks={tasks} onOpen={(task) => void openTask(task)} />

      {/* 搜索和新建任务 */}
      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_auto_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={14} />
            <input
              className={cn(inputClass, "pl-9")}
              placeholder="搜索任务编号、标题、负责人..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select className={selectClass} value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
            <option value="">全部负责人</option>
            {assignees.map((assignee) => (
              <option key={assignee.name} value={assignee.name}>
                {assignee.label || assignee.name}
              </option>
            ))}
          </select>
          <label className={toggleClass} title="显示已归档任务">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => {
                setIncludeArchived(event.target.checked);
                void refresh(currentBoard?.slug);
              }}
            />
            显示归档
          </label>
          <label className={toggleClass} title="按负责人分组">
            <input type="checkbox" checked={laneByProfile} onChange={(event) => setLaneByProfile(event.target.checked)} />
            按人分组
          </label>
        </div>

        {/* 快速创建任务 */}
        <div className="mt-3 grid gap-2 lg:grid-cols-[160px_minmax(180px,1fr)_minmax(180px,1fr)_150px_160px_auto]">
          <select className={selectClass} value={newTaskColumn} onChange={(event) => setNewTaskColumn(event.target.value as ColumnId)} title="任务初始状态">
            {columns
              .filter((column) => column.id !== "running" && column.id !== "done")
              .map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
          </select>
          <input className={inputClass} placeholder="任务标题（必填）" value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} />
          <input className={inputClass} placeholder="任务描述 / 需求说明" value={newTaskBody} onChange={(event) => setNewTaskBody(event.target.value)} />
          <input className={inputClass} placeholder="优先级（数字）" value={newTaskPriority} onChange={(event) => setNewTaskPriority(event.target.value)} />
          <select className={selectClass} value={newTaskAssignee} onChange={(event) => setNewTaskAssignee(event.target.value)} title="分配给哪位 AI 负责人">
            <option value="">未分配</option>
            {assignees.map((assignee) => (
              <option key={assignee.name} value={assignee.name}>
                {assignee.label || assignee.name}
              </option>
            ))}
          </select>
          <NativeButton size="sm" onClick={() => void createTask()}>
            <Plus size={13} /> 添加任务
          </NativeButton>
        </div>
      </section>

      {/* 消息提示 */}
      {error ? <Notice tone="red" text={error} /> : null}
      {message ? <Notice tone="green" text={message} onClose={() => setMessage("")} /> : null}

      {/* 看板列 */}
      <div className="grid items-start gap-3 2xl:grid-cols-6 xl:grid-cols-3 lg:grid-cols-2">
        {columns.map((column) => (
          <Column
            key={column.id}
            column={column}
            tasks={taskGroups.get(column.id) ?? []}
            diagnosticsByTask={diagnosticsByTask}
            laneByProfile={laneByProfile && column.id === "running"}
            assignById={assignById}
            blockReasonById={blockReasonById}
            assignees={assignees}
            onAssignChange={(taskId, value) => setAssignById((current) => ({ ...current, [taskId]: value }))}
            onBlockReasonChange={(taskId, value) => setBlockReasonById((current) => ({ ...current, [taskId]: value }))}
            onOpen={openTask}
            onAction={runTaskAction}
          />
        ))}
      </div>

      {/* 任务详情侧边栏 */}
      {selectedTask ? (
        <TaskDrawer
          task={selectedTask}
          log={taskLog}
          diagnostics={diagnosticsByTask.get(selectedTask.id) ?? selectedTask.diagnostics ?? []}
          assignees={assignees}
          assignValue={assignById[selectedTask.id] ?? selectedTask.assignee ?? ""}
          blockReason={blockReasonById[selectedTask.id] ?? ""}
          editResult={editResultById[selectedTask.id] ?? ""}
          editSummary={editSummaryById[selectedTask.id] ?? ""}
          tasks={tasks}
          currentBoard={currentBoard}
          onAssignChange={(value) => setAssignById((current) => ({ ...current, [selectedTask.id]: value }))}
          onBlockReasonChange={(value) => setBlockReasonById((current) => ({ ...current, [selectedTask.id]: value }))}
          onEditResultChange={(value) => setEditResultById((current) => ({ ...current, [selectedTask.id]: value }))}
          onEditSummaryChange={(value) => setEditSummaryById((current) => ({ ...current, [selectedTask.id]: value }))}
          onAction={(action) => void runTaskAction(selectedTask, action)}
          onOpen={openTask}
          onClose={() => setSelectedTask(null)}
          onComment={async (text) => {
            if (!currentBoard) return;
            await runAction(async () => {
              await window.workbenchClient.commentKanbanTask({ board: currentBoard.slug, taskId: selectedTask.id, text });
              const detail = await window.workbenchClient.getKanbanTask({ board: currentBoard.slug, taskId: selectedTask.id });
              setSelectedTask(detail);
            }, "评论已添加");
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------- 小组件 ---------- */

function Metric(props: { label: string; value: number; tone?: "amber" | "green" | "red" | "slate"; icon?: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
      <div className="flex items-center justify-between text-[11px] font-medium uppercase text-slate-400">
        <span>{props.label}</span>
        {props.icon ?? <span className={cn("h-2 w-2 rounded-full", metricDot(props.tone))} />}
      </div>
      <strong className="mt-1 block text-lg font-semibold tabular-nums text-slate-900">{props.value}</strong>
    </div>
  );
}

/** 诊断告警条 */
function AttentionStrip(props: { diagnostics: HermesKanbanDiagnostic[]; tasks: HermesKanbanTask[]; onOpen: (task: HermesKanbanTask) => void }) {
  const rows = props.diagnostics
    .map((diag) => ({ diag, task: props.tasks.find((task) => task.id === diag.task_id) }))
    .filter((row): row is { diag: HermesKanbanDiagnostic; task: HermesKanbanTask } => Boolean(row.task));
  if (!rows.length) return null;
  return (
    <section className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert size={15} /> {rows.length} 个任务需要关注
        </div>
        <span className="text-rose-600">来自 Hermes 诊断系统</span>
      </div>
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        {rows.slice(0, 4).map(({ task }) => (
          <button
            key={task.id}
            className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-left ring-1 ring-rose-100 hover:bg-rose-100"
            onClick={() => props.onOpen(task)}
            type="button"
          >
            <span className="font-mono text-[11px] text-rose-500">{task.id}</span>
            <span className="min-w-0 flex-1 truncate font-medium text-rose-900">{task.title}</span>
            <ChevronRight size={13} />
          </button>
        ))}
      </div>
    </section>
  );
}

/** 单列 */
function Column(props: {
  column: { id: string; label: string; help: string };
  tasks: HermesKanbanTask[];
  diagnosticsByTask: Map<string, HermesKanbanDiagnostic[]>;
  laneByProfile: boolean;
  assignById: Record<string, string>;
  blockReasonById: Record<string, string>;
  assignees: HermesKanbanAssignee[];
  onAssignChange: (taskId: string, value: string) => void;
  onBlockReasonChange: (taskId: string, value: string) => void;
  onOpen: (task: HermesKanbanTask) => Promise<void>;
  onAction: (task: HermesKanbanTask, action: HermesKanbanTaskAction) => Promise<void>;
}) {
  const laneGroups = useMemo(() => {
    const map = new Map<string, HermesKanbanTask[]>();
    for (const task of props.tasks) {
      const key = task.assignee || "未分配";
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return Array.from(map.entries());
  }, [props.tasks]);

  return (
    <section className="flex max-h-[calc(100vh-260px)] min-h-[360px] flex-col rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="px-1 pb-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", statusDot(props.column.id))} />
          <h4 className="flex-1 text-sm font-semibold text-slate-900">{props.column.label}</h4>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-100">{props.tasks.length}</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{props.column.help}</p>
      </div>
      <div className="custom-scrollbar grid flex-1 gap-2 overflow-y-auto pr-1">
        {props.tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">暂无任务</div>
        ) : null}
        {props.laneByProfile
          ? laneGroups.map(([lane, laneTasks]) => (
              <div key={lane} className="grid gap-2 border-t border-dashed border-slate-200 pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase text-slate-400">
                  <UserRound size={12} /> <span className="font-mono">{lane}</span>
                  <span className="ml-auto">{laneTasks.length}</span>
                </div>
                {laneTasks.map((task) => (
                  <TaskCard key={task.id} {...props} task={task} diagnostics={props.diagnosticsByTask.get(task.id) ?? []} />
                ))}
              </div>
            ))
          : props.tasks.map((task) => <TaskCard key={task.id} {...props} task={task} diagnostics={props.diagnosticsByTask.get(task.id) ?? []} />)}
      </div>
    </section>
  );
}

/** 任务卡片 */
function TaskCard(props: {
  task: HermesKanbanTask;
  diagnostics: HermesKanbanDiagnostic[];
  assignById: Record<string, string>;
  blockReasonById: Record<string, string>;
  assignees: HermesKanbanAssignee[];
  onAssignChange: (taskId: string, value: string) => void;
  onBlockReasonChange: (taskId: string, value: string) => void;
  onOpen: (task: HermesKanbanTask) => Promise<void>;
  onAction: (task: HermesKanbanTask, action: HermesKanbanTaskAction) => Promise<void>;
}) {
  const { task } = props;
  const assigneeValue = props.assignById[task.id] ?? task.assignee ?? "";
  return (
    <article className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md hover:ring-indigo-200">
      <button className="block w-full text-left" onClick={() => void props.onOpen(task)} type="button">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] text-slate-400">{task.id}</span>
              {task.priority !== undefined ? (
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">P{String(task.priority)}</span>
              ) : null}
              {props.diagnostics.length ? (
                <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">告警</span>
              ) : null}
            </div>
            <h5 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-950">{task.title}</h5>
          </div>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px]", statusClass(String(task.status)))}>{statusName[String(task.status)] ?? task.status}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span>{task.assignee ? `@${task.assignee}` : "未分配"}</span>
          {task.tenant ? <span>{task.tenant}</span> : null}
          {task.latest_summary ? <span className="min-w-0 flex-1 truncate">{task.latest_summary}</span> : null}
        </div>
      </button>

      {/* 快速操作（未结束的任务才显示） */}
      {task.status !== "done" && task.status !== "archived" ? (
        <div className="mt-2 grid gap-1">
          <select
            className={smallSelectClass}
            value={assigneeValue}
            onChange={(event) => props.onAssignChange(task.id, event.target.value)}
            title="更改负责人"
          >
            <option value="">分配给...</option>
            {props.assignees.map((assignee) => (
              <option key={assignee.name} value={assignee.name}>
                {assignee.label || assignee.name}
              </option>
            ))}
          </select>
          <input
            className={smallInputClass}
            placeholder="阻塞原因（如需阻塞）"
            value={props.blockReasonById[task.id] ?? ""}
            onChange={(event) => props.onBlockReasonChange(task.id, event.target.value)}
          />
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {assigneeValue && assigneeValue !== task.assignee ? (
          <ActionButton onClick={() => props.onAction(task, "assign")} title="确认分配">分配</ActionButton>
        ) : null}
        {task.status === "blocked" ? <ActionButton onClick={() => props.onAction(task, "unblock")} title="解除阻塞">解除阻塞</ActionButton> : null}
        {task.status !== "blocked" && task.status !== "done" ? (
          <ActionButton onClick={() => props.onAction(task, "block")} title="标记为阻塞">阻塞</ActionButton>
        ) : null}
        {task.status !== "done" ? (
          <ActionButton onClick={() => props.onAction(task, "complete")} title="标记完成">
            <CheckCircle2 size={12} /> 完成
          </ActionButton>
        ) : null}
        {task.status === "running" ? (
          <ActionButton onClick={() => props.onAction(task, "reclaim")} title="回收任务（中断执行）">
            <Play size={12} /> 回收
          </ActionButton>
        ) : null}
        {task.status === "triage" ? (
          <ActionButton onClick={() => props.onAction(task, "specify")} title="自动细化需求">细化需求</ActionButton>
        ) : null}
        {task.status === "done" ? (
          <ActionButton onClick={() => props.onAction(task, "archive")} title="归档任务">
            <Archive size={12} /> 归档
          </ActionButton>
        ) : null}
      </div>
    </article>
  );
}

/** 任务详情侧边栏 */
function TaskDrawer(props: {
  task: HermesKanbanTask;
  log: string;
  diagnostics: HermesKanbanDiagnostic[];
  assignees: HermesKanbanAssignee[];
  assignValue: string;
  blockReason: string;
  editResult: string;
  editSummary: string;
  tasks: HermesKanbanTask[];
  currentBoard?: HermesKanbanBoard;
  onAssignChange: (value: string) => void;
  onBlockReasonChange: (value: string) => void;
  onEditResultChange: (value: string) => void;
  onEditSummaryChange: (value: string) => void;
  onAction: (action: HermesKanbanTaskAction) => void;
  onOpen: (task: HermesKanbanTask) => Promise<void>;
  onClose: () => void;
  onComment?: (text: string) => Promise<void>;
}) {
  const task = props.task;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" onClick={props.onClose}>
      <aside
        className="flex h-full w-[min(680px,92vw)] flex-col border-l border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase text-slate-400">{task.id}</p>
            <h3 className="mt-1 truncate text-lg font-semibold text-slate-950">{task.title}</h3>
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={props.onClose} type="button" aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="custom-scrollbar grid flex-1 gap-4 overflow-y-auto p-5">
          {/* 基本信息 */}
          <section className="grid gap-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100 sm:grid-cols-3">
            <Meta label="当前状态" value={statusName[String(task.status)] ?? String(task.status)} />
            <Meta label="负责人" value={task.assignee || "未分配"} />
            <Meta label="优先级" value={task.priority === undefined ? "无" : String(task.priority)} />
            <Meta label="创建人" value={task.created_by || "-"} />
            <Meta label="创建时间" value={formatTs(task.created_at)} />
            <Meta label="开始时间" value={formatTs(task.started_at) || "-"} />
            {task.completed_at ? <Meta label="完成时间" value={formatTs(task.completed_at)} /> : null}
            <Meta label="工作区" value={task.workspace_kind ? `${task.workspace_kind}${task.workspace_path ? ` @ ${task.workspace_path}` : ""}` : "-"} />
            <Meta label="重试次数" value={task.max_retries === undefined ? "默认" : String(task.max_retries)} />
          </section>

          {/* 关联技能 */}
          {task.skills?.length ? (
            <section className="grid gap-2">
              <h4 className="text-sm font-semibold text-slate-900">关联技能</h4>
              <div className="flex flex-wrap gap-1.5">
                {task.skills.map((s) => (
                  <span key={s} className="rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-100">
                    {s}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {/* 任务依赖 */}
          {task.parents?.length || task.children?.length ? (
            <section className="grid gap-2">
              <h4 className="text-sm font-semibold text-slate-900">任务依赖</h4>
              {task.parents?.length ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">前置任务：</span>
                  {task.parents.map((pid) => (
                    <button
                      key={pid}
                      className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700 hover:bg-slate-200"
                      onClick={() => {
                        const parent = props.tasks.find((t) => t.id === pid);
                        if (parent) props.onOpen(parent);
                      }}
                      type="button"
                    >
                      {pid}
                    </button>
                  ))}
                </div>
              ) : null}
              {task.children?.length ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">后续任务：</span>
                  {task.children.map((cid) => (
                    <button
                      key={cid}
                      className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700 hover:bg-slate-200"
                      onClick={() => {
                        const child = props.tasks.find((t) => t.id === cid);
                        if (child) props.onOpen(child);
                      }}
                      type="button"
                    >
                      {cid}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* 需求/结果 */}
          <section className="grid gap-2">
            <h4 className="text-sm font-semibold text-slate-900">需求 / 结果</h4>
            <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700 ring-1 ring-slate-100">
              {task.body || task.result || task.latest_summary || "暂无内容"}
            </div>
          </section>

          {/* 操作面板 */}
          <section className="grid gap-2 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-900">操作面板</h4>
              <span className="text-xs text-slate-400">底层由 Hermes CLI 执行</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
              <select className={selectClass} value={props.assignValue} onChange={(event) => props.onAssignChange(event.target.value)}>
                <option value="">未分配</option>
                {props.assignees.map((assignee) => (
                  <option key={assignee.name} value={assignee.name}>
                    {assignee.label || assignee.name}
                  </option>
                ))}
              </select>
              <input className={inputClass} placeholder="阻塞原因" value={props.blockReason} onChange={(event) => props.onBlockReasonChange(event.target.value)} />
            </div>
            {task.status === "done" ? (
              <div className="grid gap-2">
                <input className={inputClass} placeholder="编辑结果内容..." value={props.editResult} onChange={(event) => props.onEditResultChange(event.target.value)} />
                <input className={inputClass} placeholder="结构化摘要（可选）" value={props.editSummary} onChange={(event) => props.onEditSummaryChange(event.target.value)} />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {props.assignValue && props.assignValue !== task.assignee ? (
                <>
                  <ActionButton onClick={() => props.onAction("assign")} title="确认分配">分配</ActionButton>
                  {task.status === "running" ? (
                    <ActionButton onClick={() => props.onAction("reassign")} title="先回收再分配给新人">回收并分配</ActionButton>
                  ) : null}
                </>
              ) : null}
              <ActionButton onClick={() => props.onAction("block")} title="标记为阻塞">阻塞</ActionButton>
              <ActionButton onClick={() => props.onAction("unblock")} title="解除阻塞状态">解除阻塞</ActionButton>
              <ActionButton onClick={() => props.onAction("complete")} title="标记为已完成">
                <CheckCircle2 size={12} /> 完成
              </ActionButton>
              <ActionButton onClick={() => props.onAction("reclaim")} title="回收正在执行的任务">
                <Play size={12} /> 回收
              </ActionButton>
              {task.status === "triage" ? <ActionButton onClick={() => props.onAction("specify")} title="AI 自动细化需求">细化需求</ActionButton> : null}
              {task.status === "done" ? <ActionButton onClick={() => props.onAction("edit")} title="修改已完成任务的结果">编辑结果</ActionButton> : null}
            </div>
          </section>

          {/* 诊断 */}
          <DrawerList
            title="诊断告警"
            empty="暂无诊断告警。"
            rows={props.diagnostics.map((diag) => ({
              key: diag.task_id ?? diag.title ?? "diag",
              title: diag.title ?? diag.severity ?? "诊断",
              body: (diag.diagnostics ?? []).map((item) => item.message ?? item.title).filter(Boolean).join("；") || diag.message || "",
            }))}
          />

          {/* 执行记录 */}
          <RunsSection runs={task.runs ?? []} />

          {/* 评论 */}
          <CommentsSection comments={task.comments ?? []} onComment={props.onComment} />

          {/* 事件 */}
          <DrawerList
            title="事件记录"
            empty="暂无事件。"
            rows={(Array.isArray(task.events) ? task.events : [])
              .slice(-20)
              .reverse()
              .map((event, index) => {
                const record = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
                return {
                  key: String(record.id ?? index),
                  title: String(record.kind ?? record.type ?? "事件"),
                  body: JSON.stringify(record.payload ?? record, null, 2),
                };
              })}
            mono
          />

          {/* 工作日志 */}
          <section className="grid gap-2">
            <h4 className="text-sm font-semibold text-slate-900">工作日志</h4>
            <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">{props.log || "暂无工作日志。"}</pre>
          </section>
        </div>
      </aside>
    </div>
  );
}

/** 列表展示 */
function DrawerList(props: { title: string; empty: string; rows: Array<{ key: string; title: string; body?: string }>; mono?: boolean }) {
  return (
    <section className="grid gap-2">
      <h4 className="text-sm font-semibold text-slate-900">{props.title}</h4>
      {props.rows.length ? (
        props.rows.map((row) => (
          <div key={row.key} className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-100">
            <strong className="block text-slate-800">{row.title}</strong>
            {row.body ? (
              <pre className={cn("mt-1 whitespace-pre-wrap break-words", props.mono ? "font-mono text-[11px]" : "font-sans")}>{row.body}</pre>
            ) : null}
          </div>
        ))
      ) : (
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-400 ring-1 ring-slate-100">{props.empty}</p>
      )}
    </section>
  );
}

/** 执行记录 */
function RunsSection(props: { runs: HermesKanbanTask["runs"] }) {
  const runs = props.runs ?? [];
  if (!runs.length) return <DrawerList title="执行记录" empty="暂无执行记录。" rows={[]} />;
  return (
    <section className="grid gap-2">
      <h4 className="text-sm font-semibold text-slate-900">执行记录</h4>
      {runs.map((run, index) => {
        const r = run ?? {};
        const outcome = r.outcome || r.status || "执行中";
        const elapsed = elapsedText(r.started_at, r.ended_at ?? r.finished_at);
        return (
          <div key={String(r.id ?? index)} className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200">
                #{String(r.id ?? index + 1)}
              </span>
              <span
                className={cn(
                  "font-semibold",
                  outcome === "success" ? "text-emerald-700" : outcome === "failed" || outcome === "crashed" ? "text-rose-700" : "text-slate-700",
                )}
              >
                {outcome}
              </span>
              {r.profile ? <span className="font-mono text-slate-500">@{r.profile}</span> : null}
              {elapsed ? <span className="text-slate-400">{elapsed}</span> : null}
              {r.worker_pid ? <span className="text-slate-400">进程:{r.worker_pid}</span> : null}
              {r.step_key ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{r.step_key}</span> : null}
            </div>
            {r.summary ? <p className="mt-1.5 text-slate-700">{String(r.summary).split("\n")[0].slice(0, 200)}</p> : null}
            {r.error ? <p className="mt-1 text-rose-600">{String(r.error).split("\n")[0].slice(0, 200)}</p> : null}
            {r.started_at ? (
              <p className="mt-1 text-[10px] text-slate-400">
                {formatTs(r.started_at)}
                {r.ended_at ?? r.finished_at ? ` → ${formatTs(r.ended_at ?? r.finished_at)}` : ""}
              </p>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/** 评论 */
function CommentsSection(props: {
  comments: Array<{ id?: string | number; author?: string; body?: string; created_at?: string | number }>;
  onComment?: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const comments = props.comments ?? [];
  async function submit() {
    if (!text.trim() || !props.onComment) return;
    setBusy(true);
    try {
      await props.onComment(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid gap-2">
      <h4 className="text-sm font-semibold text-slate-900">评论</h4>
      {comments.length ? (
        comments.map((c, i) => (
          <div key={String(c.id ?? i)} className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-100">
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="font-semibold text-slate-700">{c.author || "匿名"}</span>
              <span>{formatTs(c.created_at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{c.body || ""}</p>
          </div>
        ))
      ) : (
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-400 ring-1 ring-slate-100">暂无评论。</p>
      )}
      {props.onComment ? (
        <div className="flex gap-2">
          <input
            className={cn(inputClass, "text-[13px]")}
            placeholder="写下你的评论..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <NativeButton size="sm" onClick={() => void submit()} disabled={busy || !text.trim()}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : "发送"}
          </NativeButton>
        </div>
      ) : null}
    </section>
  );
}

function Meta(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase text-slate-400">{props.label}</p>
      <strong className={cn("mt-1 block truncate text-sm text-slate-900", props.mono ? "font-mono" : "")}>{props.value}</strong>
    </div>
  );
}

/** 时间格式化 */
function formatTs(ts: string | number | undefined): string {
  if (!ts) return "";
  const num = typeof ts === "string" ? (ts.includes("T") ? Date.parse(ts) : Number(ts) * 1000) : Number(ts) * 1000;
  if (!num || Number.isNaN(num)) return String(ts);
  try {
    return new Date(num).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(ts);
  }
}

/** 耗时计算 */
function elapsedText(start?: string | number, end?: string | number): string {
  if (!start) return "";
  const s = typeof start === "string" ? Number(start) : start;
  const e = end ? (typeof end === "string" ? Number(end) : end) : Math.floor(Date.now() / 1000);
  if (!s || Number.isNaN(s)) return "";
  const sec = Math.max(0, e - s);
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟`;
  return `${(sec / 3600).toFixed(1)}小时`;
}

function ActionButton(props: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button className={buttonClass} onClick={props.onClick} type="button" title={props.title}>
      {props.children}
    </button>
  );
}

function Notice(props: { tone: "red" | "green"; text: string; onClose?: () => void }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs", props.tone === "red" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
      <span>{props.text}</span>
      {props.onClose ? (
        <button type="button" onClick={props.onClose}>
          关闭
        </button>
      ) : null}
    </div>
  );
}

/** 状态样式 */
function statusClass(status: string) {
  if (status === "done") return "bg-blue-50 text-blue-700";
  if (status === "blocked") return "bg-rose-50 text-rose-700";
  if (status === "running") return "bg-emerald-50 text-emerald-700";
  if (status === "ready") return "bg-amber-50 text-amber-700";
  if (status === "triage") return "bg-fuchsia-50 text-fuchsia-700";
  return "bg-slate-100 text-slate-600";
}

function statusDot(status: string) {
  if (status === "triage") return "bg-fuchsia-400";
  if (status === "ready") return "bg-amber-400";
  if (status === "running") return "bg-emerald-500";
  if (status === "blocked") return "bg-rose-500";
  if (status === "done") return "bg-blue-500";
  return "bg-slate-400";
}

function metricDot(tone?: "amber" | "green" | "red" | "slate") {
  if (tone === "amber") return "bg-amber-400";
  if (tone === "green") return "bg-emerald-500";
  if (tone === "red") return "bg-rose-500";
  return "bg-slate-400";
}

/* 样式常量 */
const inputClass =
  "w-full rounded-md bg-white px-3 py-2 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200 transition-shadow focus:ring-2 focus:ring-indigo-100";
const smallInputClass =
  "w-full rounded-md bg-slate-50 px-2 py-1.5 text-[12px] text-slate-700 outline-none ring-1 ring-slate-100 focus:ring-2 focus:ring-indigo-100";
const selectClass =
  "w-full rounded-md bg-white px-3 py-2 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200 transition-shadow focus:ring-2 focus:ring-indigo-100";
const smallSelectClass =
  "w-full rounded-md bg-slate-50 px-2 py-1.5 text-[12px] text-slate-700 outline-none ring-1 ring-slate-100 focus:ring-2 focus:ring-indigo-100";
const toggleClass = "flex items-center justify-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-100";
const buttonClass = "inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-200";
