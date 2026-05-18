import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TaskPreflightService } from "./task-preflight-service";
import type { RuntimeConfig } from "../shared/types";

describe("TaskPreflightService", () => {
  it("drops cached Hermes health after repair/config maintenance invalidation", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-preflight-workspace-"));
    const snapshotRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-preflight-snapshots-"));
    const healthCheck = vi.fn()
      .mockResolvedValueOnce({ available: false, message: "old repair error" })
      .mockResolvedValueOnce({ available: true, message: "ready" });
    const config: RuntimeConfig = {
      updateSources: {},
      enginePaths: {},
      enginePermissions: { hermes: { enabled: true, workspaceRead: true, fileWrite: true, commandRun: true, memoryRead: true, contextBridge: true } },
      modelProfiles: [{ id: "local-real", provider: "local", model: "real-model" }],
      defaultModelProfileId: "local-real",
      hermesRuntime: { mode: "windows", pythonCommand: "python", windowsAgentMode: "hermes_native" },
    };
    const service = new TaskPreflightService(
      {
        workspaceSnapshotDir: (workspaceId: string) => path.join(snapshotRoot, workspaceId),
      } as any,
      { isLocked: () => false } as any,
      { healthCheck } as any,
      { read: vi.fn().mockResolvedValue(config) } as any,
      { hasSecret: vi.fn() } as any,
    );
    const input = {
      userInput: "hello",
      taskType: "custom" as const,
      workspacePath,
      sessionFilesPath: workspacePath,
      selectedFiles: [],
      attachments: [],
      modelProfileId: "local-real",
    };

    await expect(service.assertCanStart(input, "hermes", "workspace-a")).rejects.toMatchObject({
      appError: { code: "ENGINE_NOT_READY" },
    });
    await expect(service.assertCanStart(input, "hermes", "workspace-a")).rejects.toMatchObject({
      appError: { code: "ENGINE_NOT_READY" },
    });
    expect(healthCheck).toHaveBeenCalledTimes(1);

    service.invalidateCaches();

    await expect(service.assertCanStart(input, "hermes", "workspace-a")).resolves.toBeUndefined();
    expect(healthCheck).toHaveBeenCalledTimes(2);
  });
});
