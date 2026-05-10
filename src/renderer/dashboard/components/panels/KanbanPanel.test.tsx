import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanPanel } from "./KanbanPanel";

describe("KanbanPanel", () => {
  beforeEach(() => {
    window.workbenchClient = {
      listKanbanBoards: vi.fn().mockResolvedValue([{ slug: "forge", name: "Forge Board", is_current: true, counts: { todo: 1 } }]),
      listKanbanTasks: vi.fn().mockResolvedValue([
        { id: "task-todo", title: "Todo task", status: "todo" },
        { id: "task-ready", title: "Ready task", status: "ready" },
        { id: "task-running", title: "Running task", status: "running" },
        { id: "task-blocked", title: "Blocked task", status: "blocked" },
        { id: "task-done", title: "Done task", status: "done" },
      ]),
      listKanbanDiagnostics: vi.fn().mockResolvedValue([{ task_id: "task-blocked", title: "Blocked task", diagnostics: [{ message: "Needs attention" }] }]),
      listKanbanAssignees: vi.fn().mockResolvedValue([{ name: "dispatcher" }]),
      getGatewayStatus: vi.fn().mockResolvedValue({ running: false, managedRunning: false, healthStatus: "stopped", message: "stopped", checkedAt: "2026-05-10T00:00:00Z" }),
      startGateway: vi.fn().mockResolvedValue({ ok: true, message: "started", status: { running: true, managedRunning: true, healthStatus: "running", message: "running", checkedAt: "2026-05-10T00:00:00Z" } }),
    } as unknown as Window["workbenchClient"];
  });

  it("renders boards, status columns, diagnostics, and gateway warning", async () => {
    render(<KanbanPanel />);

    expect(await screen.findByText("Forge Board")).toBeInTheDocument();
    for (const label of ["待分类", "待处理", "就绪", "执行中", "已阻塞", "已完成"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Todo task")).toBeInTheDocument();
    expect(screen.getByText("调度器未启动")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/需要关注/)).toBeInTheDocument());
    expect(screen.getAllByText("Blocked task").length).toBeGreaterThan(0);
  });
});
