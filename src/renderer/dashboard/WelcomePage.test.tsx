import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { WelcomePage } from "./WelcomePage";
import type { SetupSummary } from "../../shared/types";

const getHermesProbe = vi.fn();
const installHermes = vi.fn();
const getRuntimeConfig = vi.fn();
const getSetupSummary = vi.fn();

beforeEach(() => {
  useAppStore.getState().resetStore();
  getHermesProbe.mockReset();
  installHermes.mockReset();
  getRuntimeConfig.mockReset();
  getSetupSummary.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network skipped")));
  Object.assign(window, {
    workbenchClient: {
      onInstallHermesEvent: vi.fn(() => () => undefined),
      getHermesProbe,
      installHermes,
      getRuntimeConfig,
      getSetupSummary,
      cancelInstallHermes: vi.fn(),
      repairSetupDependency: vi.fn(),
    },
  });
  getRuntimeConfig.mockResolvedValue({ hermesRuntime: { mode: "windows" } });
  getSetupSummary.mockResolvedValue({ checks: [], blocking: [], ready: false } satisfies SetupSummary);
});

describe("WelcomePage Hermes installation", () => {
  it("routes first launch to model settings when Hermes is healthy but model setup is missing", async () => {
    const onComplete = vi.fn();
    getHermesProbe.mockResolvedValue({
      probe: {
        status: "healthy",
        message: "ready",
        secondaryMetric: "Hermes Agent v1",
      },
    });
    getSetupSummary.mockResolvedValue({
      checks: [],
      ready: false,
      blocking: [
        {
          id: "model",
          label: "模型",
          status: "missing",
          message: "未配置默认模型",
          fixAction: "configure_model",
          blocking: true,
        },
      ],
    } satisfies SetupSummary);

    render(<WelcomePage onComplete={onComplete} />);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("model");
    }, { timeout: 1500 });
  });

  it("opens source selection on first missing Hermes detection instead of installing silently", async () => {
    getHermesProbe.mockResolvedValue({
      probe: {
        status: "offline",
        message: "missing",
        secondaryMetric: "",
      },
    });

    render(<WelcomePage onComplete={vi.fn()} />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("选择 Hermes Agent 安装来源")).toBeInTheDocument();
    expect(installHermes).not.toHaveBeenCalled();
  });

  it("starts mirror install after the user selects the community mirror", async () => {
    getHermesProbe.mockResolvedValue({
      probe: {
        status: "offline",
        message: "missing",
        secondaryMetric: "",
      },
    });
    installHermes.mockResolvedValue({ ok: false, message: "failed", rootPath: "C:/Hermes", log: [] });

    render(<WelcomePage onComplete={vi.fn()} />);

    const mirrorButton = await screen.findByRole("button", { name: /国内社区镜像/ });
    fireEvent.click(mirrorButton);

    await waitFor(() => {
      expect(installHermes).toHaveBeenCalledWith({ source: { kind: "mirror" } });
    });
  });
});
