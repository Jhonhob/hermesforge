import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "./ChatInput";
import { useAppStore } from "../store";

describe("ChatInput", () => {
  beforeEach(() => {
    useAppStore.getState().resetStore();
    useAppStore.setState({
      activeSessionId: "session-1",
      workspacePath: "D:/workspace/demo",
      runtimeConfig: {
        defaultModelProfileId: "main",
        modelProfiles: [{ id: "main", provider: "custom", model: "qwen", maxTokens: 1000 }],
        updateSources: {},
      },
      webUiOverview: {
        settings: { theme: "green-light", language: "zh", sendKey: "enter", sendKeyHintDismissed: false, showUsage: false, showCliSessions: true },
        projects: [],
        spaces: [],
        skills: [],
        memory: [],
        crons: [],
        profiles: [],
        slashCommands: [
          { name: "/help", description: "显示可用命令", usage: "/help" },
          { name: "/goal", description: "设置或查看 Hermes 持久目标", usage: "/goal [text | pause | resume | clear | status]" },
        ],
      },
    });
    window.workbenchClient = {
      saveWebUiSettings: vi.fn(async (input) => ({
        ...useAppStore.getState().webUiOverview!.settings,
        ...input,
      })),
    } as unknown as Window["workbenchClient"];
  });

  function renderInput(onStartTask = vi.fn()) {
    render(
      <ChatInput
        onStartTask={onStartTask}
        onCancelTask={vi.fn()}
        onRestoreSnapshot={vi.fn()}
        canStart
        latestSnapshotAvailable={false}
        locked={false}
      />,
    );
    return onStartTask;
  }

  it("passes /goal through to Hermes instead of treating it as an unknown local command", () => {
    const onStartTask = renderInput();
    const input = screen.getByLabelText("给 Hermes 发送消息");

    fireEvent.change(input, { target: { value: "/goal 做完这个功能" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onStartTask).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().pendingClarifyCards).toEqual([]);
    expect(useAppStore.getState().userInput).toBe("/goal 做完这个功能");
  });

  it("shows /goal in help text and slash completion", () => {
    renderInput();
    const input = screen.getByLabelText("给 Hermes 发送消息");

    fireEvent.change(input, { target: { value: "/" } });
    expect(screen.getByText("/goal")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "/help" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useAppStore.getState().pendingClarifyCards[0]?.question).toContain("/goal");
  });

  it("updates a single /help card instead of stacking duplicates", () => {
    renderInput();
    const input = screen.getByLabelText("给 Hermes 发送消息");

    fireEvent.change(input, { target: { value: "/help" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "/help" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const cards = useAppStore.getState().pendingClarifyCards;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: "slash-help", status: "pending" });
    expect(useAppStore.getState().userInput).toBe("");
  });

  it("shows actual context usage and remaining window when usage events are available", () => {
    useAppStore.setState({
      taskEventsByRunId: {
        "task-1": [{
          taskRunId: "task-1",
          workSessionId: "session-1",
          sessionId: "task-1",
          engineId: "hermes",
          event: {
            type: "usage",
            inputTokens: 600,
            outputTokens: 100,
            totalTokens: 700,
            estimatedCostUsd: 0,
            source: "actual",
            message: "actual",
            at: "2026-05-18T10:00:00.000Z",
          },
        }],
      },
      userInput: "abcd",
    });

    renderInput();

    const meter = screen.getByLabelText(/实测当前上下文占用/);
    expect(meter).toHaveAttribute("aria-label", expect.stringContaining("701 tokens"));
    expect(meter).toHaveAttribute("aria-label", expect.stringContaining("剩余：299 tokens"));
  });

  it("does not label a newer estimated run as actual because an older run had actual usage", () => {
    useAppStore.setState({
      taskEventsByRunId: {
        "task-1": [{
          taskRunId: "task-1",
          workSessionId: "session-1",
          sessionId: "task-1",
          engineId: "hermes",
          event: {
            type: "usage",
            inputTokens: 600,
            outputTokens: 100,
            totalTokens: 700,
            estimatedCostUsd: 0,
            source: "actual",
            message: "actual",
            at: "2026-05-18T10:00:00.000Z",
          },
        }],
        "task-2": [{
          taskRunId: "task-2",
          workSessionId: "session-1",
          sessionId: "task-2",
          engineId: "hermes",
          event: {
            type: "usage",
            inputTokens: 40,
            outputTokens: 10,
            totalTokens: 50,
            estimatedCostUsd: 0,
            source: "estimated",
            message: "estimate",
            at: "2026-05-18T10:01:00.000Z",
          },
        }],
      },
      userInput: "abcd",
    });

    renderInput();

    expect(screen.getByLabelText(/估算当前上下文占用/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/实测当前上下文占用/)).toBeNull();
  });

  it("shows an inline send-key chooser and hides it after the user chooses", async () => {
    const onStartTask = renderInput();

    expect(screen.getByLabelText("发送方式")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ctrl+Enter 发送" }));

    await waitFor(() => expect(window.workbenchClient.saveWebUiSettings).toHaveBeenCalledWith({
      sendKey: "mod-enter",
      sendKeyHintDismissed: true,
    }));
    expect(screen.queryByLabelText("发送方式")).toBeNull();

    const input = screen.getByLabelText("给 Hermes 发送消息");
    fireEvent.change(input, { target: { value: "继续检查" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onStartTask).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onStartTask).toHaveBeenCalledTimes(1);
  });
});
