import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineAdapter } from "../adapters/engine-adapter";
import type { AppPaths } from "../main/app-paths";
import type { RuntimeConfigStore } from "../main/runtime-config";
import type { RuntimeConfig } from "../shared/types";
import { NativeInstallStrategy } from "./native-install-strategy";

const runCommandMock = vi.fn();

vi.mock("../process/command-runner", () => ({
  runCommand: (...args: Parameters<typeof runCommandMock>) => runCommandMock(...args),
}));

let tempRoot = "";
let config: RuntimeConfig;
let healthCheckMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "native-install-strategy-"));
  vi.stubEnv("LOCALAPPDATA", tempRoot);
  config = { modelProfiles: [], updateSources: {}, enginePaths: {} };
  healthCheckMock = vi.fn()
    .mockResolvedValueOnce({
      engineId: "hermes",
      label: "Hermes",
      available: false,
      mode: "cli",
      message: "missing",
    })
    .mockResolvedValue({
      engineId: "hermes",
      label: "Hermes",
      available: true,
      mode: "cli",
      path: defaultWindowsInstallRoot(),
      message: "ready",
    });
  runCommandMock.mockReset();
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("NativeInstallStrategy Windows installer", () => {
  it("omits removed official script flags when running the latest installer", async () => {
    const installerRuns: string[][] = [];
    mockOfficialInstaller({
      script: [
        "param(",
        "  [switch]$NoVenv,",
        "  [switch]$SkipSetup,",
        "  [string]$HermesHome,",
        "  [string]$InstallDir",
        ")",
      ].join("\n"),
      installerRuns,
    });
    const service = createStrategy();

    const result = await service.install();

    expect(result.ok).toBe(true);
    expect(installerRuns).toHaveLength(1);
    expect(installerRuns[0]).not.toContain("-WithSystemPackages");
  });

  it("keeps legacy official script flags when the downloaded installer supports them", async () => {
    const installerRuns: string[][] = [];
    mockOfficialInstaller({
      script: [
        "param(",
        "  [switch]$SkipSetup,",
        "  [switch]$WithSystemPackages,",
        "  [string]$HermesHome,",
        "  [string]$InstallDir",
        ")",
      ].join("\n"),
      installerRuns,
    });
    const service = createStrategy();

    const result = await service.install();

    expect(result.ok).toBe(true);
    expect(installerRuns[0]).toContain("-WithSystemPackages");
  });

  it("treats swallowed PowerShell installer failures as failed installs", async () => {
    mockOfficialInstaller({
      script: "param([switch]$SkipSetup,[string]$HermesHome,[string]$InstallDir)",
      installerStdout: "Installation failed: Git not available and auto-install failed",
      createHermes: false,
    });
    const service = createStrategy();

    const result = await service.install();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("官方安装脚本报告失败");
    expect(config.enginePaths?.hermes).toBeUndefined();
  });
});

function mockOfficialInstaller(input: {
  script: string;
  installerRuns?: string[][];
  installerStdout?: string;
  createHermes?: boolean;
}) {
  runCommandMock.mockImplementation(async (command: string, args: string[] = [], options?: { cwd?: string }) => {
    if (command === "powershell.exe" && args.includes("-Command") && args.some((arg) => arg.includes("Invoke-WebRequest"))) {
      const commandText = args.at(-1) ?? "";
      const outFile = /-OutFile '([^']+)'/.exec(commandText)?.[1];
      if (!outFile) return { exitCode: 1, stdout: "", stderr: "missing OutFile" };
      await fs.mkdir(path.dirname(outFile), { recursive: true });
      await fs.writeFile(outFile, input.script, "utf8");
      return { exitCode: 0, stdout: "downloaded", stderr: "" };
    }
    if (command === "powershell.exe" && args.includes("-File")) {
      input.installerRuns?.push([...args]);
      const rootPath = valueAfter(args, "-InstallDir") ?? defaultWindowsInstallRoot();
      if (input.createHermes !== false) {
        await fs.mkdir(path.join(rootPath, "venv", "Scripts"), { recursive: true });
        await fs.writeFile(path.join(rootPath, "venv", "Scripts", "hermes.exe"), "", "utf8");
        await fs.writeFile(path.join(rootPath, "pyproject.toml"), "[project]\nname='hermes-agent'\n", "utf8");
      }
      return { exitCode: 0, stdout: input.installerStdout ?? "installed", stderr: "" };
    }
    if (command.endsWith("hermes.exe") && args[0] === "--version") {
      return { exitCode: 0, stdout: "Hermes Agent v0.13.0 (2026.5.7)", stderr: "" };
    }
    if (command === "powershell.exe" && args.includes("[Environment]::SetEnvironmentVariable")) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "powershell.exe" && args.at(-1)?.includes("$PSVersionTable")) {
      return { exitCode: 0, stdout: "5.1", stderr: "" };
    }
    return { exitCode: 0, stdout: `${command} ${args.join(" ")} ${options?.cwd ?? ""}`, stderr: "" };
  });
}

function createStrategy() {
  const appPaths = {
    baseDir: () => tempRoot,
    hermesDir: () => path.join(tempRoot, "profiles", "default", "hermes"),
  } as AppPaths;
  const configStore = {
    read: async () => config,
    write: async (next: RuntimeConfig) => {
      config = next;
      return next;
    },
    getEnginePath: async () => config.enginePaths?.hermes ?? defaultWindowsInstallRoot(),
  } as RuntimeConfigStore;
  const hermes = {
    healthCheck: healthCheckMock,
  } as EngineAdapter;
  return new NativeInstallStrategy(appPaths, hermes, configStore);
}

function defaultWindowsInstallRoot() {
  return process.platform === "win32"
    ? path.join(tempRoot, "hermes", "hermes-agent")
    : path.join(os.homedir(), "Hermes Agent");
}

function valueAfter(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
