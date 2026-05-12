import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CronEditor } from "./CronEditor";

describe("CronEditor", () => {
  it("requires scripts but not prompt in no_agent mode", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { rerender } = render(
      <CronEditor
        value={{ name: "Watchdog", schedule: "every 1h", noAgent: true, prompt: "" }}
        onChange={onChange}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("button", { name: /保存/ })).toBeDisabled();
    expect(screen.getByPlaceholderText(/FORGE_CRON_NO_AGENT_OK/)).toBeInTheDocument();

    rerender(
      <CronEditor
        value={{ name: "Watchdog", schedule: "every 1h", noAgent: true, prompt: "", script: "watchdog.py" }}
        onChange={onChange}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("button", { name: /保存/ })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps prompt required in agent mode", () => {
    render(
      <CronEditor
        value={{ name: "Agent task", schedule: "every 1h", noAgent: false, prompt: "" }}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /保存/ })).toBeDisabled();
    expect(screen.getByPlaceholderText(/Hermes Agent/)).toBeInTheDocument();
  });
});
