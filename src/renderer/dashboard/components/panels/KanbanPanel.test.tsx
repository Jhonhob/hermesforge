import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanPanel } from "./KanbanPanel";

describe("KanbanPanel", () => {
  beforeEach(() => {
    window.workbenchClient = {
      listKanbanBoards: vi.fn().mockResolvedValue([{ slug: "forge", name: "Forge Board", is_current: true, counts: { todo: 1 } }]),
      createKanbanBoard: vi.fn().mockResolvedValue({ ok: true, message: "created" }),
      switchKanbanBoard: vi.fn().mockResolvedValue({ ok: true, message: "switched" }),
      deleteKanbanBoard: vi.fn().mockResolvedValue({ ok: true, message: "deleted" }),
      renameKanbanBoard: vi.fn().mockResolvedValue({ ok: true, message: "renamed" }),
      dispatchKanban: vi.fn().mockResolvedValue({ ok: true, message: "dispatched" }),
      listKanbanTasks: vi.fn().mockResolvedValue([
        { id: "task-todo", title: "Todo task", status: "todo" },
        { id: "task-ready", title: "Ready task", status: "ready" },
        { id: "task-running", title: "Running task", status: "running" },
        { id: "task-blocked", title: "Blocked task", status: "blocked" },
        { id: "task-done", title: "Done task", status: "done" },
        { id: "task-child", title: "Child task", status: "todo", parents: ["parent-1"] },
      ]),
      listKanbanDiagnostics: vi.fn().mockResolvedValue([{ task_id: "task-blocked", title: "Blocked task", diagnostics: [{ message: "Needs attention" }] }]),
      listKanbanAssignees: vi.fn().mockResolvedValue([{ name: "dispatcher" }]),
      createKanbanTask: vi.fn().mockResolvedValue({ id: "task-new", title: "New task", status: "todo" }),
      getKanbanTask: vi.fn().mockImplementation(({ taskId }: { taskId: string }) =>
        Promise.resolve(
          taskId === "parent-1"
            ? { id: "parent-1", title: "Parent task", status: "done", children: ["task-child"] }
            : { id: "task-child", title: "Child task", status: "todo", parents: ["parent-1"] },
        ),
      ),
      readKanbanTaskLog: vi.fn().mockResolvedValue({ ok: true, message: "log" }),
      runKanbanTaskAction: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
      commentKanbanTask: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
      getGatewayStatus: vi.fn().mockResolvedValue({ running: false, managedRunning: false, healthStatus: "stopped", message: "stopped", checkedAt: "2026-05-10T00:00:00Z" }),
      startGateway: vi.fn().mockResolvedValue({ ok: true, message: "started", status: { running: true, managedRunning: true, healthStatus: "running", message: "running", checkedAt: "2026-05-10T00:00:00Z" } }),
    } as unknown as Window["workbenchClient"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders boards, status columns, diagnostics, and gateway warning", async () => {
    render(<KanbanPanel />);

    expect(await screen.findByText("Forge Board")).toBeInTheDocument();
    for (const label of ["待分类", "待处理", "就绪", "执行中", "已阻塞", "已完成"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Todo task")).toBeInTheDocument();
    expect(screen.getByText("调度器未启动")).toBeInTheDocument();

    // Diagnostics shown as stat pill and inline badge
    await waitFor(() => expect(screen.getAllByText("告警").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Blocked task").length).toBeGreaterThan(0);
  });

  it("refreshes with the real archived toggle state", async () => {
    render(<KanbanPanel />);

    await screen.findByText("Forge Board");
    fireEvent.click(screen.getByTitle("显示已归档任务"));

    await waitFor(() =>
      expect(window.workbenchClient.listKanbanTasks).toHaveBeenLastCalledWith({ board: "forge", archived: true }),
    );
  });

  it("only offers initial task states supported by Hermes create", async () => {
    render(<KanbanPanel />);

    await screen.findByText("Forge Board");
    // Open the create-task form
    fireEvent.click(screen.getByRole("button", { name: /新建任务/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "任务状态" }));
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["待分类", "待处理"]);
  });

  it("creates tasks against the Hermes default board when no board is listed yet", async () => {
    vi.mocked(window.workbenchClient.listKanbanBoards).mockResolvedValue([]);
    vi.mocked(window.workbenchClient.listKanbanTasks).mockResolvedValue([]);

    render(<KanbanPanel />);

    await waitFor(() => expect(window.workbenchClient.listKanbanTasks).toHaveBeenCalledWith({ archived: false }));
    // Open the create-task form
    fireEvent.click(screen.getByRole("button", { name: /新建任务/ }));
    fireEvent.change(screen.getByPlaceholderText("任务标题（必填）"), { target: { value: "Default board task" } });
    const submitBtns = screen.getAllByRole("button", { name: /新建/ });
    const submitBtn = submitBtns.find((b) => b.textContent?.trim() === "新建") ?? submitBtns[submitBtns.length - 1];
    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(window.workbenchClient.createKanbanTask).toHaveBeenCalledWith(expect.objectContaining({
        board: undefined,
        title: "Default board task",
        triage: false,
      })),
    );
  });

  it("shows a clear validation message when creating without a title", async () => {
    render(<KanbanPanel />);

    await screen.findByText("Forge Board");
    // Open the create-task form
    fireEvent.click(screen.getByRole("button", { name: /新建任务/ }));
    // Click the form submit button (not the toolbar "新建任务" button)
    const submitBtns = screen.getAllByRole("button", { name: /新建/ });
    const submitBtn = submitBtns.find((b) => b.textContent?.trim() === "新建") ?? submitBtns[submitBtns.length - 1];
    fireEvent.click(submitBtn);

    expect(screen.getByText("请先填写任务标题。")).toBeInTheDocument();
    expect(window.workbenchClient.createKanbanTask).not.toHaveBeenCalled();
  });

  it("opens dependency tasks even when they are not in the visible task list", async () => {
    render(<KanbanPanel />);

    fireEvent.click(await screen.findByText("Child task"));
    await waitFor(() =>
      expect(window.workbenchClient.getKanbanTask).toHaveBeenCalledWith({ board: "forge", taskId: "task-child" }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "parent-1" }));

    await waitFor(() =>
      expect(window.workbenchClient.getKanbanTask).toHaveBeenCalledWith({ board: "forge", taskId: "parent-1" }),
    );
  });

  it("falls back to an existing board after deleting the active board", async () => {
    vi.mocked(window.workbenchClient.listKanbanBoards)
      .mockResolvedValueOnce([{ slug: "forge", name: "Forge Board", is_current: true, counts: { todo: 1 } }])
      .mockResolvedValueOnce([{ slug: "default", name: "Default", is_current: true, counts: { todo: 0 } }]);

    render(<KanbanPanel />);

    // Open the "更多操作" dropdown menu
    fireEvent.click(await screen.findByTitle("更多操作"));
    // Click "删除看板" menu item
    fireEvent.click(await screen.findByText("删除看板"));
    // ConfirmCard appears — click the confirm button
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));

    await waitFor(() => expect(window.workbenchClient.deleteKanbanBoard).toHaveBeenCalledWith("forge"));
    await waitFor(() =>
      expect(window.workbenchClient.listKanbanTasks).toHaveBeenLastCalledWith({ board: "default", archived: false }),
    );
  });
});
