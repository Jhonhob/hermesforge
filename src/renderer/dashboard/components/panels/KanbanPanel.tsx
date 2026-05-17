import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileText,
  Filter,
  History,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
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
import { cn, NativeButton, NativeCard } from "../../DashboardPrimitives";
import { ConfirmCard } from "../ConfirmCard";

/* ========== 常量定义 ========== */

const columns = [
  { id: "triage", label: "待分类", help: "新想法，还没确定具体要做什么", icon: Filter, accent: "fuchsia" },
  { id: "todo", label: "待处理", help: "已确认需求，等待分配或依赖完成", icon: ClipboardList, accent: "slate" },
  { id: "ready", label: "就绪", help: "已分配负责人，等待系统调度执行", icon: Play, accent: "amber" },
  { id: "running", label: "执行中", help: "AI 正在处理这个任务", icon: Loader2, accent: "emerald" },
  { id: "blocked", label: "已阻塞", help: "需要人工介入才能继续", icon: Pause, accent: "rose" },
  { id: "done", label: "已完成", help: "任务已结束", icon: CheckCircle2, accent: "blue" },
] as const;

const creatableColumns = columns.filter((c) => c.id === "triage" || c.id === "todo");
const droppableColumns = new Set(["blocked", "done"]);

const statusName: Record<string, string> = {
  triage: "待分类",
  todo: "待处理",
  ready: "就绪",
  running: "执行中",
  blocked: "已阻塞",
  done: "已完成",
  archived: "已归档",
};

const accentMap: Record<string, { bg: string; text: string; ring: string; dot: string; pill: string }> = {
  fuchsia: { bg: "bg-slate-50",   text: "text-slate-600",   ring: "ring-slate-200",   dot: "bg-slate-400",   pill: "bg-slate-100 text-slate-600" },
  slate:   { bg: "bg-slate-50",   text: "text-slate-500",   ring: "ring-slate-200",   dot: "bg-slate-400",   pill: "bg-slate-100 text-slate-600" },
  amber:   { bg: "bg-amber-50",   text: "text-amber-600",   ring: "ring-amber-100",   dot: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 ring-1 ring-amber-100" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", ring: "ring-emerald-100", dot: "bg-emerald-500", pill: "bg-emerald-100 text-emerald-700" },
  rose:    { bg: "bg-rose-50",    text: "text-rose-600",    ring: "ring-rose-100",    dot: "bg-rose-500",    pill: "bg-rose-100 text-rose-700" },
  blue:    { bg: "bg-sky-50",     text: "text-sky-600",     ring: "ring-sky-100",     dot: "bg-sky-500",     pill: "bg-sky-50 text-sky-700 ring-1 ring-sky-100" },
};

type ColumnId = (typeof columns)[number]["id"];

/* ========== 主面板 ========== */

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
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [laneByProfile, setLaneByProfile] = useState(true);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [newBoardSlug, setNewBoardSlug] = useState("");
  const [newBoardName, setNewBoardName] = useState("");
  const [showRenameBoard, setShowRenameBoard] = useState(false);
  const [renameBoardName, setRenameBoardName] = useState("");
  const [showCreateTask, setShowCreateTask] = useState(false);
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
  const [confirmingDeleteBoard, setConfirmingDeleteBoard] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => { void refresh(); }, []);

  // Auto-refresh polling
  useEffect(() => {
    if (autoRefresh) {
      refreshTimerRef.current = setInterval(() => { void refresh(); }, 15_000);
    }
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [autoRefresh, activeBoard, includeArchived]);

  const currentBoard = useMemo(
    () => boards.find((b) => b.slug === activeBoard) ?? boards.find((b) => b.is_current) ?? boards[0],
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
      if (statusFilter && task.status !== statusFilter) return false;
      if (!q) return true;
      return `${task.id} ${task.title} ${task.assignee ?? ""} ${task.tenant ?? ""} ${task.body ?? ""}`.toLowerCase().includes(q);
    });
  }, [assigneeFilter, includeArchived, search, statusFilter, tasks]);

  const taskGroups = useMemo(() => {
    const grouped = new Map<string, HermesKanbanTask[]>();
    for (const c of columns) grouped.set(c.id, []);
    for (const task of filteredTasks) {
      const key = columns.some((c) => c.id === task.status) ? String(task.status) : "todo";
      grouped.set(key, [...(grouped.get(key) ?? []), task]);
    }
    return grouped;
  }, [filteredTasks]);

  const stats = useMemo(() => {
    const counts = columns.reduce<Record<string, number>>((acc, c) => {
      acc[c.id] = taskGroups.get(c.id)?.length ?? 0;
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

  function selectedBoardSlug() {
    return currentBoard?.slug || activeBoard || undefined;
  }

  const refresh = useCallback(async function refreshFn(boardSlug = activeBoard, archived = includeArchived) {
    if (!window.workbenchClient) return;
    setBusy(true);
    setError("");
    try {
      const [boardList, gatewayStatus] = await Promise.all([
        window.workbenchClient.listKanbanBoards(),
        window.workbenchClient.getGatewayStatus().catch(() => null),
      ]);
      const requestedBoard = boardSlug && boardList.some((b) => b.slug === boardSlug) ? boardSlug : "";
      const nextBoard = requestedBoard || boardList.find((b) => b.is_current)?.slug || boardList[0]?.slug || "";
      setBoards(boardList);
      setActiveBoard(nextBoard);
      setGateway(gatewayStatus);
      const taskListOptions = nextBoard ? { board: nextBoard, archived } : { archived };
      const [nextTasks, nextDiagnostics, nextAssignees] = await Promise.all([
        window.workbenchClient.listKanbanTasks(taskListOptions),
        window.workbenchClient.listKanbanDiagnostics(nextBoard ? { board: nextBoard } : {}).catch(() => []),
        window.workbenchClient.listKanbanAssignees(nextBoard || undefined).catch(() => []),
      ]);
      setTasks(nextTasks);
      setDiagnostics(nextDiagnostics);
      setAssignees(nextAssignees);
    } catch (err) {
      setError(err instanceof Error ? err.message : "看板加载失败，请刷新重试。");
    } finally {
      setBusy(false);
    }
  }, [activeBoard, includeArchived]);

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
    await runAction(async () => {
      await window.workbenchClient.deleteKanbanBoard(slug);
      setConfirmingDeleteBoard(null);
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
    if (!newTaskTitle.trim()) { setError("请先填写任务标题。"); return; }
    const initialColumn = column === "triage" ? "triage" : "todo";
    const board = selectedBoardSlug();
    await runAction(async () => {
      await window.workbenchClient.createKanbanTask({
        board,
        title: newTaskTitle.trim(),
        body: newTaskBody.trim() || undefined,
        assignee: newTaskAssignee.trim() || undefined,
        priority: newTaskPriority.trim() || undefined,
        triage: initialColumn === "triage",
      });
      setNewTaskTitle("");
      setNewTaskBody("");
      setNewTaskPriority("");
      setShowCreateTask(false);
      await refresh(board);
    }, "任务创建成功");
  }

  async function moveTask(taskId: string, targetStatus: string) {
    const board = selectedBoardSlug();
    const actionMap: Record<string, HermesKanbanTaskAction> = {
      done: "complete",
      blocked: "block",
    };
    const action = actionMap[targetStatus];
    if (action) {
      await runAction(async () => {
        await window.workbenchClient.runKanbanTaskAction({ board, taskId, action, reason: action === "block" ? "拖拽至阻塞列" : undefined });
        await refresh(board);
      }, `任务已移至${statusName[targetStatus] ?? targetStatus}`);
    }
  }

  async function runTaskAction(task: HermesKanbanTask, action: HermesKanbanTaskAction) {
    const board = selectedBoardSlug();
    const reason = action === "block" ? blockReasonById[task.id]?.trim() || "从前端看板手动阻塞" : undefined;
    const assignee = action === "assign" || action === "reassign" ? assignById[task.id]?.trim() || newTaskAssignee.trim() : undefined;
    const result = action === "edit" ? editResultById[task.id]?.trim() : action === "complete" ? "从前端看板标记完成" : undefined;
    const summary = action === "edit" ? editSummaryById[task.id]?.trim() || undefined : undefined;
    if (action === "edit" && !result) { setError("编辑结果时，需要填写新的结果内容。"); return; }
    await runAction(async () => {
      await window.workbenchClient.runKanbanTaskAction({ board, taskId: task.id, action, reason, assignee, result, summary, reclaim: action === "reassign" });
      setBlockReasonById((c) => ({ ...c, [task.id]: "" }));
      setEditResultById((c) => ({ ...c, [task.id]: "" }));
      setEditSummaryById((c) => ({ ...c, [task.id]: "" }));
      await refresh(board);
      if (selectedTask?.id === task.id) await loadTaskDetail(task.id);
    }, "操作成功");
  }

  async function loadTaskDetail(taskId: string) {
    const board = selectedBoardSlug();
    const detail = await window.workbenchClient.getKanbanTask({ board, taskId });
    setSelectedTask(detail);
    const log = await window.workbenchClient.readKanbanTaskLog({ board, taskId, tail: 500 }).catch(() => ({ message: "" }));
    setTaskLog(log.message);
  }

  async function openTask(task: HermesKanbanTask) { await openTaskById(task.id); }

  async function openTaskById(taskId: string) {
    await runAction(async () => { await loadTaskDetail(taskId); }, "");
  }

  async function runAction(fn: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    try { await fn(); if (success) setMessage(success); }
    catch (err) { setError(err instanceof Error ? err.message : "操作失败，请重试。"); }
    finally { setBusy(false); }
  }

  // Drag-and-drop handlers
  function handleDragStart(e: React.DragEvent, task: HermesKanbanTask) {
    e.dataTransfer.setData("text/plain", task.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, columnId: string) {
    if (!droppableColumns.has(columnId)) {
      e.dataTransfer.dropEffect = "none";
      setDragOverColumn(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnId);
  }

  function handleDragLeave() {
    setDragOverColumn(null);
  }

  function handleDrop(e: React.DragEvent, columnId: string) {
    e.preventDefault();
    setDragOverColumn(null);
    const taskId = e.dataTransfer.getData("text/plain");
    if (taskId && columnId === "done") {
      void moveTask(taskId, columnId);
    } else if (taskId && columnId === "blocked") {
      void moveTask(taskId, columnId);
    }
  }

  const boardTitle = currentBoard?.name || currentBoard?.slug || "默认看板";
  const boardFocus = useMemo(() => {
    if (stats.total === 0) return { label: "等待任务进入", detail: "先放入一个待处理或待分类任务", action: "create" as const };
    if (stats.blocked > 0) return { label: "存在阻塞", detail: `${stats.blocked} 个任务需要处理`, action: "blocked" as const };
    if (!gateway?.running && stats.ready > 0) return { label: "等待调度器", detail: `${stats.ready} 个就绪任务可执行`, action: "start" as const };
    if (gateway?.running && stats.ready > 0) return { label: "可以调度", detail: `${stats.ready} 个就绪任务等待分派`, action: "dispatch" as const };
    if (stats.running > 0) return { label: "正在执行", detail: `${stats.running} 个任务进行中`, action: "running" as const };
    return { label: "队列平稳", detail: `${stats.total} 个任务已纳入看板`, action: "idle" as const };
  }, [gateway?.running, stats.blocked, stats.ready, stats.running, stats.total]);

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-5 border-b border-slate-100 p-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <BoardSelector
                boards={boards}
                currentSlug={currentBoard?.slug ?? ""}
                onChange={(slug) => void switchBoard(slug)}
              />
              <GatewayPill running={gateway?.running ?? false} />
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
                autoRefresh ? "bg-white text-slate-500 ring-slate-200" : "bg-slate-100 text-slate-500 ring-slate-200",
              )}>
                <RefreshCw size={12} className={cn(autoRefresh && busy && "animate-spin")} />
                {autoRefresh ? "自动刷新" : "手动刷新"}
              </span>
            </div>
            <h3 className="mt-3 truncate text-xl font-semibold tracking-normal text-slate-950">{boardTitle} 工作台</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono text-slate-400">{currentBoard?.slug || "default"}</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{boardFocus.label}</span>
              <span className="text-slate-400">{boardFocus.detail}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <NativeButton size="sm" variant="primary" onClick={() => setShowCreateTask((v) => !v)}>
              <Plus size={14} /> 新建任务
            </NativeButton>
            {boardFocus.action === "start" && (
              <NativeButton size="sm" onClick={() => void runAction(async () => { await window.workbenchClient.startGateway(); await refresh(currentBoard?.slug); }, "Gateway 启动成功")}>
                <Play size={14} /> 启动调度器
              </NativeButton>
            )}
            {boardFocus.action === "dispatch" && (
              <NativeButton size="sm" onClick={() => void dispatchBoard()}>
                <Zap size={14} /> 立即调度
              </NativeButton>
            )}
            <ToolbarButton
              icon={autoRefresh ? RefreshCw : Pause}
              title={autoRefresh ? "暂停自动刷新" : "开启自动刷新"}
              onClick={() => setAutoRefresh((v) => !v)}
              spin={autoRefresh && busy}
            />
            <MoreMenu
              onCreateBoard={() => setShowCreateBoard((v) => !v)}
              onRenameBoard={currentBoard ? () => { setShowRenameBoard((v) => !v); setRenameBoardName(currentBoard.name || ""); } : undefined}
              onDeleteBoard={currentBoard && currentBoard.slug !== "default" ? () => setConfirmingDeleteBoard(currentBoard.slug) : undefined}
              onDispatch={gateway?.running ? () => void dispatchBoard() : undefined}
              onStartGateway={!gateway?.running ? () => void runAction(async () => { await window.workbenchClient.startGateway(); await refresh(currentBoard?.slug); }, "Gateway 启动成功") : undefined}
              onRefresh={() => void refresh(currentBoard?.slug)}
              busy={busy}
            />
          </div>
        </div>
        <BoardFlow counts={stats.counts} total={stats.total} diagnostics={stats.diagnostics} />
      </section>

      {/* ===== 新建/重命名看板 ===== */}
      {showCreateBoard && (
        <NativeCard className="border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between pb-3">
            <div>
              <span className="text-sm font-semibold text-slate-900">新建看板</span>
              <p className="mt-0.5 text-xs text-slate-400">用于隔离不同项目或工作流</p>
            </div>
            <IconButton onClick={() => setShowCreateBoard(false)}><X size={14} /></IconButton>
          </div>
          <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
            <input className={inputClass} placeholder="看板标识（如：project-a）" value={newBoardSlug} onChange={(e) => setNewBoardSlug(e.target.value)} />
            <input className={inputClass} placeholder="看板显示名称" value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} />
            <NativeButton size="sm" onClick={() => void createBoard()}>创建</NativeButton>
          </div>
        </NativeCard>
      )}
      {showRenameBoard && currentBoard && (
        <NativeCard className="border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between pb-3">
            <div>
              <span className="text-sm font-semibold text-slate-900">重命名看板</span>
              <p className="mt-0.5 text-xs text-slate-400">{currentBoard.slug}</p>
            </div>
            <IconButton onClick={() => setShowRenameBoard(false)}><X size={14} /></IconButton>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input className={inputClass} placeholder="新的看板名称" value={renameBoardName} onChange={(e) => setRenameBoardName(e.target.value)} />
            <NativeButton size="sm" onClick={() => void renameBoard()}>确认</NativeButton>
          </div>
        </NativeCard>
      )}

      {/* ===== 系统状态提示 ===== */}
      <SystemStatusStrip
        gatewayRunning={gateway?.running ?? false}
        diagnostics={diagnostics}
        tasks={tasks}
        onOpen={(task) => void openTask(task)}
      />

      {/* ===== 筛选工具栏 ===== */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        assigneeFilter={assigneeFilter}
        onAssigneeChange={setAssigneeFilter}
        assignees={assignees}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        includeArchived={includeArchived}
        onArchivedChange={(v) => { setIncludeArchived(v); void refresh(currentBoard?.slug, v); }}
        laneByProfile={laneByProfile}
        onLaneChange={setLaneByProfile}
      />

      {/* ===== 快速创建任务 ===== */}
      {showCreateTask && (
        <NativeCard className="border-slate-200 bg-white p-4 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950">
                <Plus size={14} className="text-white" />
              </div>
              <div>
                <span className="text-sm font-semibold text-slate-900">新建任务</span>
                <p className="mt-0.5 text-xs text-slate-400">标题决定卡片，描述会进入任务详情</p>
              </div>
            </div>
            <IconButton onClick={() => setShowCreateTask(false)}><X size={14} /></IconButton>
          </div>
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inputClass} placeholder="任务标题（必填）" value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} autoFocus />
              <input className={inputClass} placeholder="任务描述 / 需求说明" value={newTaskBody} onChange={(e) => setNewTaskBody(e.target.value)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-[140px_1fr_140px_auto]">
              <SoftSelect
                label="任务状态"
                value={newTaskColumn}
                options={creatableColumns.map((c) => ({ value: c.id, label: c.label }))}
                onChange={(value) => setNewTaskColumn(value as ColumnId)}
              />
              <SoftSelect
                label="负责人"
                value={newTaskAssignee}
                options={[{ value: "", label: "未分配" }, ...assignees.map((a) => ({ value: a.name, label: a.label || a.name }))]}
                onChange={setNewTaskAssignee}
              />
              <input className={inputClass} placeholder="优先级" value={newTaskPriority} onChange={(e) => setNewTaskPriority(e.target.value)} />
              <NativeButton size="sm" onClick={() => void createTask()}>
                <Plus size={14} /> 新建
              </NativeButton>
            </div>
          </div>
        </NativeCard>
      )}

      {/* ===== 消息提示 ===== */}
      {error ? <Notice tone="red" text={error} onClose={() => setError("")} /> : null}
      {message ? <Notice tone="green" text={message} onClose={() => setMessage("")} /> : null}
      {confirmingDeleteBoard ? (
        <ConfirmCard
          title={`删除看板：${confirmingDeleteBoard}`}
          body="此操作不可恢复，看板下的所有任务和数据都将被永久删除。"
          tone="danger"
          onCancel={() => setConfirmingDeleteBoard(null)}
          onConfirm={() => void deleteBoard(confirmingDeleteBoard)}
        />
      ) : null}

      {/* ===== 看板列 ===== */}
      <div className="custom-scrollbar flex items-start gap-3 overflow-x-auto pb-2">
        {columns.map((column) => (
          <Column
            key={column.id}
            column={column}
            tasks={taskGroups.get(column.id) ?? []}
            diagnosticsByTask={diagnosticsByTask}
            laneByProfile={laneByProfile && column.id === "running"}
            isDragOver={dragOverColumn === column.id}
            canDrop={droppableColumns.has(column.id)}
            onOpen={openTask}
            onAction={runTaskAction}
            onQuickCreate={column.id === "triage" || column.id === "todo" ? () => { setShowCreateTask(true); setNewTaskColumn(column.id); } : undefined}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragStart={handleDragStart}
          />
        ))}
      </div>

      {/* ===== 任务详情侧边栏 ===== */}
      {selectedTask && (
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
          onAssignChange={(v) => setAssignById((c) => ({ ...c, [selectedTask.id]: v }))}
          onBlockReasonChange={(v) => setBlockReasonById((c) => ({ ...c, [selectedTask.id]: v }))}
          onEditResultChange={(v) => setEditResultById((c) => ({ ...c, [selectedTask.id]: v }))}
          onEditSummaryChange={(v) => setEditSummaryById((c) => ({ ...c, [selectedTask.id]: v }))}
          onAction={(action) => void runTaskAction(selectedTask, action)}
          onOpenTaskId={openTaskById}
          onClose={() => setSelectedTask(null)}
          onComment={async (text) => {
            const board = selectedBoardSlug();
            await runAction(async () => {
              await window.workbenchClient.commentKanbanTask({ board, taskId: selectedTask.id, text });
              const detail = await window.workbenchClient.getKanbanTask({ board, taskId: selectedTask.id });
              setSelectedTask(detail);
            }, "评论已添加");
          }}
        />
      )}
    </div>
  );
}


/* ========== 子组件 ========== */

function BoardFlow(props: { counts: Record<string, number>; total: number; diagnostics: number }) {
  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {columns.map((column, index) => {
          const accent = accentMap[column.accent] ?? accentMap.slate;
          const Icon = column.icon;
          const count = props.counts[column.id] ?? 0;
          return (
            <div key={column.id} className="group rounded-xl border border-slate-200/70 bg-slate-50/50 p-3 transition hover:border-slate-300 hover:bg-white">
              <div className="flex items-center gap-2">
                <span className={cn("grid h-7 w-7 place-items-center rounded-lg bg-white ring-1", accent.ring)}>
                  <Icon size={14} className={accent.text} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-700">{column.label}</span>
                <strong className="font-mono text-sm text-slate-900">{count}</strong>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
                <div
                  className={cn("h-full rounded-full transition-all", accent.dot)}
                  style={{ width: `${props.total ? Math.max(8, Math.round((count / props.total) * 100)) : 0}%` }}
                />
              </div>
              {index < columns.length - 1 ? <ArrowRight size={12} className="mt-2 hidden text-slate-300 xl:block" /> : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        <StatPill value={props.total} label="全部" />
        <StatPill value={props.counts.running ?? 0} label="执行中" tone="emerald" />
        <StatPill value={props.counts.blocked ?? 0} label="阻塞" tone="rose" />
        {props.diagnostics > 0 ? <StatPill value={props.diagnostics} label="告警" tone="red" /> : null}
      </div>
    </div>
  );
}

/** 看板选择器 */
function BoardSelector(props: {
  boards: HermesKanbanBoard[];
  currentSlug: string;
  onChange: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = props.boards.find((b) => b.slug === props.currentSlug);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm font-semibold text-slate-900 transition-all hover:border-slate-300 hover:bg-slate-50"
      >
        <LayoutGrid size={15} className="text-slate-500" />
        <span className="max-w-[160px] truncate">{current?.name || current?.slug || "选择看板"}</span>
        <ChevronDown size={14} className={cn("text-slate-400 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[240px] rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-xl animate-in fade-in slide-in-from-top-1 duration-150">
            {props.boards.map((board) => (
              <button
                key={board.slug}
                type="button"
                onClick={() => { props.onChange(board.slug); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors",
                  board.slug === props.currentSlug
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-slate-700 hover:bg-slate-50"
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", board.is_current ? "bg-emerald-500" : "bg-slate-300")} />
                <span className="truncate">{board.name || board.slug}</span>
                {board.is_current && <span className="ml-auto text-[10px] text-emerald-600 font-medium">当前</span>}
              </button>
            ))}
            {props.boards.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-slate-400">暂无看板</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Gateway 状态标签 */
function GatewayPill(props: { running: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
      props.running
        ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
        : "bg-white text-amber-700 ring-amber-200"
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", props.running ? "bg-emerald-500 animate-pulse" : "bg-amber-400")} />
      {props.running ? "调度器运行中" : "调度器未启动"}
    </span>
  );
}

/** 统计小标签 */
function StatPill(props: { value: number; label: string; tone?: "slate" | "emerald" | "rose" | "red" }) {
  const toneMap = {
    slate: "bg-slate-100/80 text-slate-600 ring-slate-200/60",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    red: "bg-red-50 text-red-700 ring-red-100",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1", toneMap[props.tone ?? "slate"])}>
      <strong className="tabular-nums">{props.value}</strong>
      <span>{props.label}</span>
    </span>
  );
}

/** 工具栏按钮 */
function ToolbarButton(props: { icon: typeof Loader2; title: string; onClick: () => void; spin?: boolean }) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
    >
      <Icon size={15} className={cn(props.spin && "animate-spin")} />
    </button>
  );
}

/** 系统状态提示 */
function SystemStatusStrip(props: {
  gatewayRunning: boolean;
  diagnostics: HermesKanbanDiagnostic[];
  tasks: HermesKanbanTask[];
  onOpen: (task: HermesKanbanTask) => void;
}) {
  const hasDiagnostics = props.diagnostics.length > 0;
  if (props.gatewayRunning && !hasDiagnostics) return null;

  const rows = props.diagnostics
    .map((diag) => ({ diag, task: props.tasks.find((t) => t.id === diag.task_id) }))
    .filter((row): row is { diag: HermesKanbanDiagnostic; task: HermesKanbanTask } => Boolean(row.task));

  return (
    <NativeCard className="border-amber-200/70 bg-amber-50/40 p-3 shadow-none">
      <div className="flex flex-wrap items-center gap-3">
        {!props.gatewayRunning && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
            <AlertTriangle size={12} /> 调度器未运行
          </span>
        )}
        {hasDiagnostics && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">
            <ShieldAlert size={12} /> {rows.length} 个告警
          </span>
        )}
        {rows.length > 0 ? (
          <div className="flex flex-1 flex-wrap gap-1.5">
            {rows.slice(0, 6).map(({ task }) => (
              <button
                key={task.id}
                className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-left text-[11px] text-slate-600 ring-1 ring-slate-200/70 transition-all hover:bg-slate-50 hover:ring-slate-300"
                onClick={() => props.onOpen(task)}
                type="button"
                title={task.title}
              >
                <span className="font-mono text-[10px] text-slate-400">{task.id}</span>
                <span className="truncate">{task.title}</span>
              </button>
            ))}
          </div>
        ) : !props.gatewayRunning ? (
          <span className="text-[11px] text-slate-400">就绪状态的任务不会自动执行，可在上方菜单启动调度器。</span>
        ) : null}
      </div>
    </NativeCard>
  );
}

/** 筛选工具栏 */
function FilterBar(props: {
  search: string;
  onSearchChange: (v: string) => void;
  assigneeFilter: string;
  onAssigneeChange: (v: string) => void;
  assignees: HermesKanbanAssignee[];
  statusFilter: string;
  onStatusChange: (v: string) => void;
  includeArchived: boolean;
  onArchivedChange: (v: boolean) => void;
  laneByProfile: boolean;
  onLaneChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/70 bg-white p-2 shadow-[0_10px_28px_rgba(15,23,42,0.035)]">
      <span className="hidden items-center gap-1.5 px-2 text-[11px] font-semibold uppercase text-slate-400 sm:inline-flex">
        <SlidersHorizontal size={13} /> 筛选
      </span>
      <label className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <input
          className={cn(inputClass, "bg-slate-50/70 pl-9 ring-transparent focus:bg-white")}
          placeholder="搜索任务编号、标题、负责人..."
          value={props.search}
          onChange={(e) => props.onSearchChange(e.target.value)}
        />
      </label>
      <SoftSelect
        className="w-auto min-w-[120px]"
        label="负责人筛选"
        value={props.assigneeFilter}
        options={[{ value: "", label: "全部负责人" }, ...props.assignees.map((a) => ({ value: a.name, label: a.label || a.name }))]}
        onChange={props.onAssigneeChange}
      />
      <SoftSelect
        className="w-auto min-w-[110px]"
        label="状态筛选"
        value={props.statusFilter}
        options={[{ value: "", label: "全部状态" }, ...columns.map((c) => ({ value: c.id, label: c.label }))]}
        onChange={props.onStatusChange}
      />
      <div className="flex items-center gap-1.5">
        <ToggleBtn active={props.includeArchived} onClick={() => props.onArchivedChange(!props.includeArchived)} title="显示已归档任务">
          <Archive size={12} /> 归档
        </ToggleBtn>
        <ToggleBtn active={props.laneByProfile} onClick={() => props.onLaneChange(!props.laneByProfile)} title="按负责人分组">
          <UserRound size={12} /> 分组
        </ToggleBtn>
      </div>
    </div>
  );
}

/** 切换按钮 */
function ToggleBtn(props: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all",
        props.active
          ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
          : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
      )}
    >
      {props.children}
    </button>
  );
}

function SoftSelect(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = props.options.find((option) => option.value === props.value) ?? props.options[0];
  return (
    <div className={cn("relative min-w-0", props.className)}>
      <button
        aria-expanded={open}
        aria-label={props.label}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg bg-white px-3 text-left text-[13px] text-slate-800 ring-1 ring-slate-200/80 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
        onClick={() => setOpen((value) => !value)}
        role="combobox"
        type="button"
      >
        <span className="truncate">{selected?.label ?? props.label}</span>
        <ChevronDown size={14} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 max-h-64 min-w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
          {props.options.map((option) => {
            const active = option.value === props.value;
            return (
              <button
                aria-selected={active}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition",
                  active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
                )}
                key={option.value || "__empty"}
                onClick={() => {
                  props.onChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span className="truncate">{option.label}</span>
                {active ? <CheckCircle2 size={13} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 看板列 */
function Column(props: {
  column: { id: string; label: string; help: string; icon: typeof Loader2; accent: string };
  tasks: HermesKanbanTask[];
  diagnosticsByTask: Map<string, HermesKanbanDiagnostic[]>;
  laneByProfile: boolean;
  isDragOver: boolean;
  canDrop: boolean;
  onOpen: (task: HermesKanbanTask) => Promise<void>;
  onAction: (task: HermesKanbanTask, action: HermesKanbanTaskAction) => Promise<void>;
  onQuickCreate?: () => void;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  onDragStart: (e: React.DragEvent, task: HermesKanbanTask) => void;
}) {
  const laneGroups = useMemo(() => {
    const map = new Map<string, HermesKanbanTask[]>();
    for (const task of props.tasks) {
      const key = task.assignee || "未分配";
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return Array.from(map.entries());
  }, [props.tasks]);

  const ColIcon = props.column.icon;
  const accent = accentMap[props.column.accent] ?? accentMap.slate;

  return (
    <section
      className={cn(
        "flex w-[286px] shrink-0 flex-col rounded-xl border bg-white p-2.5 transition-all duration-200",
        props.isDragOver
          ? "border-slate-900 bg-slate-50 shadow-lg shadow-slate-200/60"
          : "border-slate-200/70",
        props.canDrop && "ring-1 ring-transparent hover:ring-slate-200"
      )}
      style={{ maxHeight: "calc(100vh - 260px)", minHeight: 360 }}
      onDragOver={(e) => props.onDragOver(e, props.column.id)}
      onDragLeave={props.onDragLeave}
      onDrop={(e) => props.onDrop(e, props.column.id)}
    >
      {/* 列头 */}
      <div className="mb-2.5 flex items-center gap-2 px-1" title={props.column.help}>
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-lg", accent.bg)}>
          <ColIcon size={13} className={accent.text} />
        </span>
        <h4 className="flex-1 text-[13px] font-semibold text-slate-800">{props.column.label}</h4>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", accent.pill)}>
          {props.tasks.length}
        </span>
      </div>

      {/* 任务列表 */}
      <p className="mb-2 px-1 text-[11px] leading-4 text-slate-400">{props.column.help}</p>

      <div className="custom-scrollbar grid flex-1 content-start gap-2 overflow-y-auto pr-1">
        {props.tasks.length === 0 && (
          <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
            <div className={cn("flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1", accent.ring)}>
              <ColIcon size={16} className={accent.text} />
            </div>
            <p className="text-[11px] text-slate-400">暂无任务</p>
            {props.onQuickCreate && (
              <button
                type="button"
                onClick={props.onQuickCreate}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
              >
                <Plus size={12} /> 新建
              </button>
            )}
          </div>
        )}

        {props.laneByProfile
          ? laneGroups.map(([lane, laneTasks]) => (
              <div key={lane} className="grid gap-2 border-t border-dashed border-slate-200/60 pt-2.5 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <UserRound size={11} />
                  <span className="font-mono">{lane}</span>
                  <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0 text-[10px]">{laneTasks.length}</span>
                </div>
                {laneTasks.map((task) => (
                  <TaskCard key={task.id} task={task} diagnostics={props.diagnosticsByTask.get(task.id) ?? []} onOpen={props.onOpen} onAction={props.onAction} onDragStart={props.onDragStart} />
                ))}
              </div>
            ))
          : props.tasks.map((task) => (
              <TaskCard key={task.id} task={task} diagnostics={props.diagnosticsByTask.get(task.id) ?? []} onOpen={props.onOpen} onAction={props.onAction} onDragStart={props.onDragStart} />
            ))}
      </div>
    </section>
  );
}


/** 任务卡片 */
function TaskCard(props: {
  task: HermesKanbanTask;
  diagnostics: HermesKanbanDiagnostic[];
  onOpen: (task: HermesKanbanTask) => Promise<void>;
  onAction: (task: HermesKanbanTask, action: HermesKanbanTaskAction) => Promise<void>;
  onDragStart: (e: React.DragEvent, task: HermesKanbanTask) => void;
}) {
  const { task } = props;
  const isArchived = task.status === "archived";
  const isDone = task.status === "done";
  const canComplete = !isDone && !isArchived;
  const hasDiagnostics = props.diagnostics.length > 0;
  const accent = accentMap[columns.find((c) => c.id === task.status)?.accent ?? "slate"] ?? accentMap.slate;

  return (
    <article
      draggable
      onDragStart={(e) => props.onDragStart(e, task)}
      className={cn(
        "group relative cursor-pointer rounded-lg border bg-white p-3 transition-all duration-200",
        "border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.035)]",
        "hover:border-slate-300 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]",
        "active:shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
      )}
      onClick={() => void props.onOpen(task)}
    >
      {/* 状态指示条 */}
      <div className={cn("absolute left-0 top-3 bottom-3 w-[3px] rounded-full", accent.dot, "opacity-35 group-hover:opacity-70 transition-opacity")} />

      {/* 顶部行：标题 + 优先级 */}
      <div className="flex items-start justify-between gap-2 pl-2">
        <h5 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-950">{task.title}</h5>
        {task.priority !== undefined && (
          <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold", accent.pill)}>
            P{String(task.priority)}
          </span>
        )}
      </div>

      {/* 元信息 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-2">
        <span className="font-mono text-[10px] text-slate-400">{task.id}</span>
        {task.assignee ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <UserRound size={10} /> {task.assignee}
          </span>
        ) : (
          <span className="text-[11px] text-slate-300">未分配</span>
        )}
        {hasDiagnostics && (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
            <ShieldAlert size={10} /> 告警
          </span>
        )}
        {task.skills?.length ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
            {task.skills.length} 技能
          </span>
        ) : null}
      </div>

      {/* 快捷操作 — hover 时显示 */}
      <div className="mt-3 flex flex-wrap gap-1.5 pl-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {task.status === "blocked" && (
          <CardAction onClick={(e) => { e.stopPropagation(); void props.onAction(task, "unblock"); }} icon={Play}>
            解除阻塞
          </CardAction>
        )}
        {canComplete && (
          <CardAction onClick={(e) => { e.stopPropagation(); void props.onAction(task, "complete"); }} icon={CheckCircle2} accent>
            完成
          </CardAction>
        )}
        {task.status === "done" && !isArchived && (
          <CardAction onClick={(e) => { e.stopPropagation(); void props.onAction(task, "archive"); }} icon={Archive}>
            归档
          </CardAction>
        )}
        {task.status === "triage" && (
          <CardAction onClick={(e) => { e.stopPropagation(); void props.onAction(task, "specify"); }} icon={Pencil}>
            细化
          </CardAction>
        )}
      </div>
    </article>
  );
}

/** 卡片内操作按钮 */
function CardAction(props: { children: ReactNode; onClick: (e: React.MouseEvent) => void; icon?: typeof CheckCircle2; accent?: boolean }) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-all active:scale-[0.97]",
        props.accent
          ? "bg-slate-950 text-white ring-1 ring-slate-950 hover:bg-slate-800"
          : "bg-slate-50 text-slate-600 ring-1 ring-slate-200/60 hover:bg-slate-100 hover:text-slate-800"
      )}
    >
      {Icon && <Icon size={11} />}
      {props.children}
    </button>
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
  onOpenTaskId: (taskId: string) => Promise<void>;
  onClose: () => void;
  onComment?: (text: string) => Promise<void>;
}) {
  const task = props.task;
  const isArchived = task.status === "archived";
  const isDone = task.status === "done";
  const canAssign = !isDone && !isArchived;
  const canBlock = !isDone && !isArchived && task.status !== "blocked";
  const canUnblock = task.status === "blocked";
  const canComplete = !isDone && !isArchived;
  const canReclaim = task.status === "running";
  const [activeTab, setActiveTab] = useState<"overview" | "runs" | "logs">("overview");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  const tabs = [
    { id: "overview" as const, label: "概览", icon: FileText },
    { id: "runs" as const, label: "执行记录", icon: History },
    { id: "logs" as const, label: "日志", icon: ClipboardList },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={props.onClose}>
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px] transition-opacity" />
      <aside
        className="relative flex h-full w-[min(760px,95vw)] flex-col border-l border-slate-200/80 bg-white shadow-2xl animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-slate-400">{task.id}</span>
              <StatusDot status={String(task.status)} />
              {task.priority !== undefined && (
                <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-slate-200">P{task.priority}</span>
              )}
            </div>
            <h3 className="mt-2 text-lg font-semibold leading-snug text-slate-950">{task.title}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{task.assignee || "未分配"}</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{formatTs(task.updated_at ?? task.created_at) || "暂无时间"}</span>
              {props.currentBoard && (
                <>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>{props.currentBoard.name || props.currentBoard.slug}</span>
                </>
              )}
            </div>
          </div>
          <IconButton onClick={props.onClose}><X size={16} /></IconButton>
        </header>

        {/* 标签页 */}
        <div className="flex border-b border-slate-100 px-6">
          {tabs.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 py-3 text-[13px] font-medium transition-colors",
                  activeTab === tab.id ? "text-slate-950" : "text-slate-500 hover:text-slate-700"
                )}
              >
                <TabIcon size={14} />
                {tab.label}
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-slate-950" />
                )}
              </button>
            );
          })}
        </div>

        {/* 内容区 */}
        <div className="custom-scrollbar flex-1 overflow-y-auto p-6">
          {activeTab === "overview" && (
            <div className="grid gap-5">
              {/* 基本信息 */}
              <section>
                <h4 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-slate-400">基本信息</h4>
                <div className="grid gap-x-5 gap-y-4 border-y border-slate-100 py-4 sm:grid-cols-3">
                  <Meta label="当前状态" value={statusName[String(task.status)] ?? String(task.status)} />
                  <Meta label="负责人" value={task.assignee || "未分配"} />
                  <Meta label="优先级" value={task.priority === undefined ? "无" : `P${task.priority}`} />
                  <Meta label="创建人" value={task.created_by || "-"} />
                  <Meta label="创建时间" value={formatTs(task.created_at)} />
                  <Meta label="开始时间" value={formatTs(task.started_at) || "-"} />
                  {task.completed_at && <Meta label="完成时间" value={formatTs(task.completed_at)} />}
                  <Meta label="工作区" value={task.workspace_kind ? `${task.workspace_kind}${task.workspace_path ? ` @ ${task.workspace_path}` : ""}` : "-"} />
                  <Meta label="重试次数" value={task.max_retries === undefined ? "默认" : String(task.max_retries)} />
                </div>
              </section>

              {/* 关联技能 */}
              {task.skills?.length ? (
                <section>
                  <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400">关联技能</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {task.skills.map((s) => (
                      <span key={s} className="rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-100">
                        {s}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* 任务依赖 */}
              {(task.parents?.length || task.children?.length) ? (
                <section>
                  <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400">任务依赖</h4>
                  <div className="rounded-xl bg-slate-50/60 p-4 ring-1 ring-slate-100">
                    {task.parents?.length ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-slate-500">前置：</span>
                        {task.parents.map((pid) => (
                          <button key={pid} className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50" onClick={() => void props.onOpenTaskId(pid)} type="button">
                            {pid}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {task.children?.length ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-slate-500">后续：</span>
                        {task.children.map((cid) => (
                          <button key={cid} className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50" onClick={() => void props.onOpenTaskId(cid)} type="button">
                            {cid}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* 需求/结果 */}
              <section>
                <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400">需求 / 结果</h4>
                <div className="whitespace-pre-wrap rounded-xl bg-slate-50/60 p-4 text-[13px] leading-6 text-slate-700 ring-1 ring-slate-100">
                  {task.body || task.result || task.latest_summary || "暂无内容"}
                </div>
              </section>

              {/* 操作面板 */}
              <section>
                <h4 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-slate-400">操作</h4>
                <div className="rounded-xl bg-slate-50/60 p-4 ring-1 ring-slate-100">
                  <div className="grid gap-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <SoftSelect
                        label="指派给"
                        value={props.assignValue}
                        options={[{ value: "", label: "未分配" }, ...props.assignees.map((a) => ({ value: a.name, label: a.label || a.name }))]}
                        onChange={props.onAssignChange}
                      />
                      <input className={inputClass} placeholder="阻塞原因" value={props.blockReason} onChange={(e) => props.onBlockReasonChange(e.target.value)} />
                    </div>
                    {task.status === "done" && (
                      <div className="grid gap-2">
                        <input className={inputClass} placeholder="编辑结果内容..." value={props.editResult} onChange={(e) => props.onEditResultChange(e.target.value)} />
                        <input className={inputClass} placeholder="结构化摘要（可选）" value={props.editSummary} onChange={(e) => props.onEditSummaryChange(e.target.value)} />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {canAssign && props.assignValue && props.assignValue !== task.assignee && (
                        <>
                          <ActionBtn onClick={() => props.onAction("assign")} icon={UserRound}>分配</ActionBtn>
                          {task.status === "running" && <ActionBtn onClick={() => props.onAction("reassign")} icon={RefreshCw}>回收并分配</ActionBtn>}
                        </>
                      )}
                      {canBlock && <ActionBtn onClick={() => props.onAction("block")} icon={Pause}>阻塞</ActionBtn>}
                      {canUnblock && <ActionBtn onClick={() => props.onAction("unblock")} icon={Play}>解除阻塞</ActionBtn>}
                      {canComplete && <ActionBtn onClick={() => props.onAction("complete")} icon={CheckCircle2} primary>完成</ActionBtn>}
                      {canReclaim && <ActionBtn onClick={() => props.onAction("reclaim")} icon={RefreshCw}>回收</ActionBtn>}
                      {task.status === "triage" && <ActionBtn onClick={() => props.onAction("specify")} icon={Pencil}>细化需求</ActionBtn>}
                      {task.status === "done" && <ActionBtn onClick={() => props.onAction("edit")} icon={Pencil}>编辑结果</ActionBtn>}
                      {task.status === "done" && <ActionBtn onClick={() => props.onAction("archive")} icon={Archive}>归档</ActionBtn>}
                    </div>
                  </div>
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

              {/* 评论 */}
              <CommentsSection comments={task.comments ?? []} onComment={props.onComment} />

              {/* 事件 */}
              <DrawerList
                title="事件记录"
                empty="暂无事件。"
                rows={(Array.isArray(task.events) ? task.events : []).slice(-20).reverse().map((event, index) => {
                  const record = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
                  return {
                    key: String(record.id ?? index),
                    title: String(record.kind ?? record.type ?? "事件"),
                    body: JSON.stringify(record.payload ?? record, null, 2),
                  };
                })}
                mono
              />
            </div>
          )}

          {activeTab === "runs" && (
            <div className="grid gap-4">
              <RunsSection runs={task.runs ?? []} />
            </div>
          )}

          {activeTab === "logs" && (
            <div>
              <h4 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-slate-400">工作日志</h4>
              <pre className="max-h-[70vh] overflow-auto rounded-xl bg-slate-950 p-4 text-[11px] leading-5 text-slate-100">
                {props.log || "暂无工作日志。"}
              </pre>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}


/* ========== 通用小组件 ========== */

function IconButton(props: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
    >
      {props.children}
    </button>
  );
}

function ActionBtn(props: { children: ReactNode; onClick: () => void; icon?: typeof CheckCircle2; primary?: boolean }) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all active:scale-[0.98]",
        props.primary
          ? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
          : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
      )}
    >
      {Icon && <Icon size={13} />}
      {props.children}
    </button>
  );
}

function StatusDot(props: { status: string }) {
  const labels: Record<string, string> = statusName;
  const colors: Record<string, string> = {
    triage: "bg-fuchsia-500",
    todo: "bg-slate-400",
    ready: "bg-amber-500",
    running: "bg-emerald-500",
    blocked: "bg-rose-500",
    done: "bg-blue-500",
    archived: "bg-slate-300",
  };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
      <span className={cn("h-1.5 w-1.5 rounded-full", colors[props.status] ?? "bg-slate-400")} />
      {labels[props.status] ?? props.status}
    </span>
  );
}

function Meta(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{props.label}</p>
      <strong className={cn("mt-1 block truncate text-[13px] text-slate-900", props.mono ? "font-mono" : "")}>{props.value}</strong>
    </div>
  );
}

/** 列表展示 */
function DrawerList(props: { title: string; empty: string; rows: Array<{ key: string; title: string; body?: string }>; mono?: boolean }) {
  return (
    <section>
      <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400">{props.title}</h4>
      {props.rows.length ? (
        <div className="grid gap-2">
          {props.rows.map((row) => (
            <div key={row.key} className="rounded-xl bg-slate-50/60 p-3 text-xs text-slate-600 ring-1 ring-slate-100">
              <strong className="block text-slate-800">{row.title}</strong>
              {row.body ? <pre className={cn("mt-1.5 whitespace-pre-wrap break-words", props.mono ? "font-mono text-[11px]" : "font-sans")}>{row.body}</pre> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-slate-50/60 p-3 text-xs text-slate-400 ring-1 ring-slate-100">{props.empty}</p>
      )}
    </section>
  );
}

/** 执行记录 */
function RunsSection(props: { runs: HermesKanbanTask["runs"] }) {
  const runs = props.runs ?? [];
  if (!runs.length) return <DrawerList title="执行记录" empty="暂无执行记录。" rows={[]} />;
  return (
    <section>
      <h4 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-slate-400">执行记录</h4>
      <div className="grid gap-2">
        {runs.map((run, index) => {
          const r = run ?? {};
          const outcome = r.outcome || r.status || "执行中";
          const elapsed = elapsedText(r.started_at, r.ended_at ?? r.finished_at);
          return (
            <div key={String(r.id ?? index)} className="rounded-xl bg-slate-50/60 p-3 text-xs text-slate-600 ring-1 ring-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-slate-200">
                  #{String(r.id ?? index + 1)}
                </span>
                <span className={cn("font-semibold",
                  outcome === "success" ? "text-emerald-700" : outcome === "failed" || outcome === "crashed" ? "text-rose-700" : "text-slate-700"
                )}>
                  {outcome}
                </span>
                {r.profile && <span className="font-mono text-slate-500">@{r.profile}</span>}
                {elapsed && <span className="text-slate-400">{elapsed}</span>}
                {r.worker_pid && <span className="text-slate-400">进程:{r.worker_pid}</span>}
                {r.step_key && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{r.step_key}</span>}
              </div>
              {r.summary && <p className="mt-2 text-slate-700">{String(r.summary).split("\n")[0].slice(0, 200)}</p>}
              {r.error && <p className="mt-1.5 text-rose-600">{String(r.error).split("\n")[0].slice(0, 200)}</p>}
              {r.started_at && (
                <p className="mt-2 text-[10px] text-slate-400">
                  {formatTs(r.started_at)}
                  {r.ended_at ?? r.finished_at ? ` → ${formatTs(r.ended_at ?? r.finished_at)}` : ""}
                </p>
              )}
            </div>
          );
        })}
      </div>
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
    try { await props.onComment(text.trim()); setText(""); }
    finally { setBusy(false); }
  }
  return (
    <section>
      <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400">评论</h4>
      {comments.length ? (
        <div className="grid gap-2 mb-3">
          {comments.map((c, i) => (
            <div key={String(c.id ?? i)} className="rounded-xl bg-slate-50/60 p-3 text-xs text-slate-600 ring-1 ring-slate-100">
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="font-semibold text-slate-700">{c.author || "匿名"}</span>
                <span>{formatTs(c.created_at)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap">{c.body || ""}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-slate-50/60 p-3 text-xs text-slate-400 ring-1 ring-slate-100 mb-3">暂无评论。</p>
      )}
      {props.onComment && (
        <div className="flex gap-2">
          <input
            className={cn(inputClass, "text-[13px] flex-1")}
            placeholder="写下你的评论..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
          />
          <NativeButton size="sm" onClick={() => void submit()} disabled={busy || !text.trim()}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : "发送"}
          </NativeButton>
        </div>
      )}
    </section>
  );
}

/** 更多操作菜单 */
function MoreMenu(props: {
  onCreateBoard: () => void;
  onRenameBoard?: () => void;
  onDeleteBoard?: () => void;
  onDispatch?: () => void;
  onStartGateway?: () => void;
  onRefresh: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        onClick={() => setOpen((v) => !v)}
        title="更多操作"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-slate-200/80 bg-white/95 p-1.5 shadow-xl backdrop-blur-sm animate-in fade-in zoom-in-95 duration-150">
            <MenuItem icon={Plus} onClick={() => { props.onCreateBoard(); setOpen(false); }}>新建看板</MenuItem>
            {props.onRenameBoard && <MenuItem icon={Pencil} onClick={() => { props.onRenameBoard?.(); setOpen(false); }}>重命名</MenuItem>}
            {props.onDeleteBoard && <MenuItem icon={Trash2} onClick={() => { props.onDeleteBoard?.(); setOpen(false); }} danger>删除看板</MenuItem>}
            <div className="my-1 border-t border-slate-100" />
            {props.onDispatch && <MenuItem icon={Zap} onClick={() => { props.onDispatch?.(); setOpen(false); }}>立即调度</MenuItem>}
            {props.onStartGateway && <MenuItem icon={Play} onClick={() => { props.onStartGateway?.(); setOpen(false); }}>启动调度器</MenuItem>}
            <MenuItem icon={props.busy ? Loader2 : RotateCcw} onClick={() => { props.onRefresh(); setOpen(false); }} spin={props.busy}>刷新</MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem(props: { icon: typeof Plus; onClick: () => void; children: ReactNode; danger?: boolean; spin?: boolean }) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
        props.danger ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50"
      )}
      onClick={props.onClick}
    >
      <Icon size={14} className={cn(props.spin && "animate-spin")} />
      {props.children}
    </button>
  );
}

function Notice(props: { tone: "red" | "green"; text: string; onClose?: () => void }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-xs ring-1",
      props.tone === "red" ? "bg-rose-50 text-rose-700 ring-rose-100" : "bg-emerald-50 text-emerald-700 ring-emerald-100"
    )}>
      <span>{props.text}</span>
      {props.onClose && <button type="button" className="font-medium hover:underline" onClick={props.onClose}>关闭</button>}
    </div>
  );
}

/* ========== 工具函数 ========== */

function formatTs(ts: string | number | undefined): string {
  if (!ts) return "";
  const num = typeof ts === "string" ? (ts.includes("T") ? Date.parse(ts) : Number(ts) * 1000) : Number(ts) * 1000;
  if (!num || Number.isNaN(num)) return String(ts);
  try {
    return new Date(num).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return String(ts); }
}

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

/* ========== 样式常量 ========== */

const inputClass =
  "w-full rounded-lg bg-white px-3 py-2 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200/80 transition-shadow focus:ring-2 focus:ring-slate-300";
