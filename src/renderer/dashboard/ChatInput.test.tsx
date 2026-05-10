import { fireEvent, render, screen } from "@testing-library/react";
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
        modelProfiles: [{ id: "main", provider: "custom", model: "qwen" }],
        updateSources: {},
      },
      webUiOverview: {
        settings: { theme: "green-light", language: "zh", sendKey: "enter", showUsage: false, showCliSessions: true },
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
      saveWebUiSettings: vi.fn(),
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
});
