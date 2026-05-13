import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EngineAdapter } from "../adapters/engine-adapter";
import type { AppPaths } from "../main/app-paths";
import { resolveActiveHermesHome } from "../main/hermes-home";
import type { RuntimeConfigStore } from "../main/runtime-config";
import { runCommand, streamCommand } from "../process/command-runner";
import type { RuntimeAdapterFactory } from "../runtime/runtime-adapter";
import type { RuntimeProbeService } from "../runtime/runtime-probe-service";
import { validateNativeHermesCli } from "../runtime/hermes-cli-resolver";
import {
  defaultHermesCliPath,
  isHermesCliExecutable,
  resolveHermesCliPath,
} from "../runtime/hermes-cli-paths";
import { getWindowsPythonInstallCandidates } from "../platform";
import type { HermesRuntimeConfig, RuntimeConfig, SetupDependencyRepairId } from "../shared/types";
import type { InstallStrategy } from "./install-strategy";
import type {
  InstallOptions,
  InstallPlan,
  InstallPublisher,
  InstallStrategyRepairResult,
  InstallStrategyResult,
  InstallStrategyUpdateResult,
} from "./install-types";
import { installStep } from "./install-types";
import { DEFAULT_PINNED_HERMES_SOURCE, resolveInstallSource, resolveInstallSourceFromOption } from "./install-source";
import type { InstallSource } from "./install-source";

const DEFAULT_INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const OFFICIAL_WINDOWS_INSTALLER_URL = "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1";
const COMMUNITY_MIRROR_WINDOWS_INSTALLER_URL = "https://res1.hermesagent.org.cn/install.ps1";
const OFFICIAL_HERMES_REPO_URL = "https://github.com/NousResearch/hermes-agent.git";

type PythonLauncher = { command: string; argsPrefix: string[]; label: string };
type GitSyncResult =
  | {
      ok: true;
      branch: string;
      remoteRef: string;
      currentCommit?: string;
      latestCommit?: string;
      behindBefore: number;
      behindAfter: number;
    }
  | {
      ok: false;
      message: string;
      branch?: string;
      remoteRef?: string;
      currentCommit?: string;
      latestCommit?: string;
      behindBefore?: number;
      behindAfter?: number;
    };

export class NativeInstallStrategy implements InstallStrategy {
  readonly kind = "native" as const;
  private installInFlight?: Promise<InstallStrategyResult>;
  private installAbortController?: AbortController;
  private installPublisher?: InstallPublisher;
  private installStartedAt?: string;

  constructor(
    private readonly appPaths: AppPaths,
    private readonly hermes: EngineAdapter,
    private readonly configStore: RuntimeConfigStore,
    private readonly runtimeProbeService?: RuntimeProbeService,
    private readonly runtimeAdapterFactory?: RuntimeAdapterFactory,
  ) {}

  async plan(options: InstallOptions = {}): Promise<InstallPlan> {
    const runtime = { mode: "windows" as const, pythonCommand: "python", windowsAgentMode: "hermes_native" as const };
    const probe = await this.runtimeProbeService?.probe({ runtime }).catch(() => undefined);
    const rootPath = await this.resolveInstallRoot(options.rootPath);
    const issues = probe?.issues ?? [];
    return {
      mode: "windows",
      ok: !probe || probe.powershellAvailable,
      summary: probe
        ? "Windows Native install.ps1 安装策略已生成计划。"
        : "Windows Native install.ps1 安装策略已生成 legacy 计划。",
      issues,
      runtimeProbe: probe,
      steps: [
        installStep({
          phase: "plan",
          step: "select-native",
          status: "passed",
          code: "native_selected",
          summary: "已选择 Windows Native install.ps1 安装策略。",
          debugContext: { rootPath },
        }),
        installStep({
          phase: "preflight",
          step: "native-dependencies",
          status: probe ? "passed" : "skipped",
          code: probe ? "runtime_probe" : "legacy_fallback",
          summary: probe ? "依赖状态来自 RuntimeProbe。" : "未注入 RuntimeProbe，安装时将使用 legacy direct checks。",
          detail: probe ? `powershell=${probe.powershellAvailable}, python=${probe.pythonAvailable}, git=${probe.gitAvailable}, winget=${probe.wingetAvailable}` : undefined,
        }),
      ],
    };
  }

  async update(): Promise<InstallStrategyUpdateResult> {
    const log: string[] = [];
    const startedAt = new Date().toISOString();
    const hermesRoot = await this.resolveInstallRoot(await this.configStore.getEnginePath("hermes"), log);
    const preflight = await this.checkInstalledHermes(hermesRoot, log).catch((error) => ({
      available: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (!preflight.available) {
      log.push(`Hermes update preflight failed; reinstalling through selected installer. Reason: ${preflight.message}`);
      const reinstall = await this.performInstallHermes(undefined, { rootPath: hermesRoot, mode: "windows" }, true);
      return {
        ok: reinstall.ok,
        engineId: "hermes",
        message: reinstall.ok
          ? "Hermes 安装已修复并通过检查。"
          : `Hermes 修复失败：${reinstall.message}`,
        log: [...log, ...reinstall.log],
        logPath: reinstall.logPath,
        plan: reinstall.plan ?? await this.plan({ rootPath: hermesRoot, mode: "windows" }),
      };
    }

    log.push("Hermes update preflight passed; synchronizing Git repository before dependency repair.");
    const gitSync = await this.syncHermesGitRepository(hermesRoot, log);
    if (!gitSync.ok) {
      const logDir = path.join(this.appPaths.baseDir(), "diagnostics", "install-logs");
      await fs.mkdir(logDir, { recursive: true });
      const logPath = path.join(logDir, `hermes-update-${startedAt.replace(/[:.]/g, "-")}.log`);
      await fs.writeFile(logPath, [gitSync.message, "", ...log].join("\n"), "utf8");
      return { ok: false, engineId: "hermes", message: gitSync.message, log, logPath, plan: await this.plan({ mode: "windows" }) };
    }

    const python = await this.detectPythonLauncher(log);
    if (python) {
      await this.installPythonDependencies(hermesRoot, log, python);
    } else {
      log.push("No system Python available for dependency refresh; continuing to Hermes health check.");
    }
    await this.repairVenvBestEffort(hermesRoot, log);

    const launch = await this.hermesMaintenanceLaunch(hermesRoot, ["doctor", "--fix"]);
    log.push(`$ ${launch.command} ${JSON.stringify(launch.args)}`);
    const result = await runCommand(launch.command, launch.args, {
      cwd: launch.cwd,
      timeoutMs: DEFAULT_INSTALL_TIMEOUT_MS,
      env: launch.env,
      commandId: "install.native.hermes.doctor-fix",
      runtimeKind: launch.runtimeKind,
    });
    if (result.stdout.trim()) log.push(result.stdout.trim());
    if (result.stderr.trim()) log.push(result.stderr.trim());
    if (result.exitCode !== 0) {
      log.push(`Hermes doctor --fix returned exit ${result.exitCode}; continuing with core CLI recheck before deciding whether to reinstall.`);
    }

    const postRepair = await this.checkInstalledHermes(hermesRoot, log).catch((error) => ({
      available: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (!postRepair.available) {
      log.push(`Hermes repair left CLI unusable; reinstalling through selected installer. Reason: ${postRepair.message}`);
      const reinstall = await this.performInstallHermes(undefined, { rootPath: hermesRoot, mode: "windows" }, true);
      return {
        ok: reinstall.ok,
        engineId: "hermes",
        message: reinstall.ok
          ? "Hermes 已通过所选安装脚本重装修复。"
          : `Hermes 重装修复后仍不可用：${reinstall.message}`,
        log: [...log, ...reinstall.log],
        logPath: reinstall.logPath,
        plan: reinstall.plan ?? await this.plan({ rootPath: hermesRoot, mode: "windows" }),
      };
    }
    const ok = true;
    const message = result.exitCode === 0
      ? `Hermes 已同步到 ${gitSync.remoteRef}${gitSync.latestCommit ? ` @ ${gitSync.latestCommit}` : ""}，并通过核心启动检查。`
      : `Hermes Git 代码已同步到 ${gitSync.remoteRef}${gitSync.latestCommit ? ` @ ${gitSync.latestCommit}` : ""}；doctor --fix 仍有非阻塞输出，请查看日志确认可选项。`;
    const logDir = path.join(this.appPaths.baseDir(), "diagnostics", "install-logs");
    await fs.mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, `hermes-repair-${startedAt.replace(/[:.]/g, "-")}.log`);
    await fs.writeFile(logPath, [message, "", ...log].join("\n"), "utf8");
    return { ok, engineId: "hermes", message, log, logPath, plan: await this.plan({ mode: "windows" }) };
  }

  async install(publish?: InstallPublisher, options: InstallOptions = {}): Promise<InstallStrategyResult> {
    if (!this.installInFlight) {
      this.installAbortController = new AbortController();
      this.installPublisher = publish;
      this.installStartedAt = new Date().toISOString();
      this.installInFlight = this.performInstallHermes(publish, options, false, this.installAbortController.signal, this.installStartedAt).finally(() => {
        this.installInFlight = undefined;
        this.installAbortController = undefined;
        this.installPublisher = undefined;
        this.installStartedAt = undefined;
      });
    }
    return await this.installInFlight;
  }

  async cancelInstall(): Promise<{ ok: boolean; message: string }> {
    if (!this.installAbortController) {
      return { ok: false, message: "当前没有正在运行的 Hermes 安装。" };
    }
    const startedAt = this.installStartedAt ?? new Date().toISOString();
    this.installPublisher?.({
      stage: "cancelling",
      progress: 96,
      message: "正在取消 Hermes 安装。",
      detail: "正在终止后台 PowerShell 安装进程...",
      startedAt,
      at: new Date().toISOString(),
    });
    this.installAbortController.abort();
    return { ok: true, message: "已请求取消 Hermes 安装，后台进程正在终止。" };
  }

  async repairDependency(id: SetupDependencyRepairId): Promise<InstallStrategyRepairResult> {
    switch (id) {
      case "git":
      case "python":
        return await this.repairWithOfficialInstaller(id);
      case "hermes_pyyaml":
        return await this.repairPythonPackage(id, "PyYAML", "PyYAML", "请重新检查 Hermes 状态，确认 yaml 模块已可导入。");
      case "hermes_python_dotenv":
        return await this.repairPythonPackage(id, "python-dotenv", "python-dotenv", "请重新检查 Hermes 状态，确认 dotenv 模块已可导入。");
      case "weixin_aiohttp":
        return await this.repairPythonPackage(id, "aiohttp", "aiohttp");
      default:
        return {
          ok: false,
          id,
          message: "未知依赖修复项。",
          recommendedFix: "请刷新系统状态后重试。",
          plan: await this.plan(),
        };
    }
  }

  private async hermesMaintenanceLaunch(hermesRoot: string, args: string[]) {
    const hermesHome = await resolveActiveHermesHome(this.appPaths.hermesDir());
    if (this.runtimeAdapterFactory) {
      const config = await this.configStore.read();
      const runtime = {
        mode: "windows" as const,
        distro: config.hermesRuntime?.distro?.trim() || undefined,
        pythonCommand: config.hermesRuntime?.pythonCommand?.trim() || "python",
        windowsAgentMode: config.hermesRuntime?.windowsAgentMode ?? "hermes_native",
      } satisfies NonNullable<RuntimeConfig["hermesRuntime"]>;
      const adapter = this.runtimeAdapterFactory(runtime);
      const runtimeRoot = adapter.toRuntimePath(hermesRoot);
      return await adapter.buildHermesLaunch({
        runtime,
        rootPath: runtimeRoot,
        pythonArgs: [await this.resolveHermesCliPath(hermesRoot), ...args],
        cwd: hermesRoot,
        env: {
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
          PYTHONPATH: runtimeRoot,
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          HERMES_HOME: adapter.toRuntimePath(hermesHome),
        },
      });
    }
    const hermesCli = await this.resolveHermesCliPath(hermesRoot);
    return {
      command: isHermesCliExecutable(hermesCli) ? hermesCli : "python",
      args: isHermesCliExecutable(hermesCli) ? args : [hermesCli, ...args],
      cwd: hermesRoot,
      env: {
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONPATH: `${hermesRoot}${path.delimiter}${process.env.PYTHONPATH ?? ""}`,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        HERMES_HOME: hermesHome,
      },
      runtimeKind: "windows" as const,
    };
  }

  private async performInstallHermes(
    publish?: InstallPublisher,
    options: InstallOptions = {},
    forceRunOfficialInstaller = false,
    signal?: AbortSignal,
    requestedStartedAt?: string,
  ): Promise<InstallStrategyResult> {
    const log: string[] = [];
    const startedAt = requestedStartedAt ?? new Date().toISOString();
    const logDir = path.join(this.appPaths.baseDir(), "diagnostics", "install-logs");
    const logPath = path.join(logDir, `hermes-install-${startedAt.replace(/[:.]/g, "-")}.log`);
    const scriptPath = path.join(logDir, `official-install-${startedAt.replace(/[:.]/g, "-")}.ps1`);

    const configForSource = await this.configStore.read().catch(() => ({ modelProfiles: [], updateSources: {} }));
    const installSource = resolveInstallSourceFromOption(configForSource, options.source);
    const installerUrls = this.installerUrlsForSource(installSource);

    const emit = (stage: Parameters<InstallPublisher>[0]["stage"], progress: number, message: string, detail?: string, extra?: Partial<Parameters<InstallPublisher>[0]>) => {
      const line = `[${stage}] ${message}${detail ? ` | ${detail}` : ""}`;
      log.push(line);
      publish?.({
        stage,
        message,
        detail,
        progress,
        startedAt,
        at: new Date().toISOString(),
        sourceLabel: installSource.sourceLabel,
        sourceUrl: extra?.sourceUrl ?? installSource.repoUrl,
        elapsedSeconds: Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
        ...extra,
      });
    };

    const finish = async (
      result: Omit<InstallStrategyResult, "engineId" | "log" | "logPath" | "plan">,
      stage: Parameters<InstallPublisher>[0]["stage"],
    ) => {
      if (stage === "completed" || stage === "failed" || stage === "cancelled") {
        emit(stage, 100, result.message, result.rootPath, {
          logPath,
          diagnosticCode: stage === "cancelled" ? "cancelled" : result.ok ? undefined : this.diagnosticCodeForOutput(log.join("\n")),
        });
      }
      await this.writeInstallLog(logDir, logPath, result.message, log);
      return { ...result, engineId: "hermes" as const, log, logPath, plan: await this.plan({ rootPath: result.rootPath, mode: "windows" }) };
    };

    try {
      this.throwIfAborted(signal);
      emit("preflight", 5, "正在检测本机环境。");
      const currentHealth = await this.hermes.healthCheck().catch((error) => {
        log.push(`Current Hermes check failed: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      });
      if (currentHealth?.available && !forceRunOfficialInstaller && this.canReuseExistingInstallForSource(installSource)) {
        const rootPath = currentHealth.path ?? await this.configStore.getEnginePath("hermes");
        await this.saveHermesRoot(rootPath, installSource);
        log.push(`Hermes is already available at ${rootPath}.`);
        return await finish({ ok: true, rootPath, message: `已检测到可用 Hermes：${rootPath}` }, "completed");
      }

      const requestedRoot = options.rootPath?.trim() || process.env.HERMES_INSTALL_DIR?.trim();
      const rootPath = await this.resolveInstallRoot(options.rootPath, log);
      const hermesHome = this.defaultHermesHomeForInstall(rootPath);
      const parentDir = path.dirname(rootPath);
      log.push(`Install target: ${rootPath}`);
      if (requestedRoot && requestedRoot !== rootPath) {
        log.push(`Ignored Windows-incompatible install target: ${requestedRoot}`);
      }
      log.push(`Hermes home: ${hermesHome}`);
      log.push(`Install source: ${installSource.sourceLabel} ${installSource.repoUrl}@${installSource.commit ?? installSource.branch ?? "main"}`);
      log.push(`Installer source(s): ${installerUrls.join(", ")}`);

      await this.assertWritableDirectory(logDir, "安装日志目录", log);
      await this.assertWritableDirectory(parentDir, "Hermes 安装父目录", log);
      await this.assertWritableDirectory(hermesHome, "Hermes home", log);

      const targetState = await this.inspectTargetDirectory(rootPath, log);
      if (targetState.exists && targetState.isEmpty) {
        await fs.rm(rootPath, { recursive: true, force: true });
        log.push(`Removed empty target directory ${rootPath} before selected installer run.`);
      } else if (targetState.exists && !targetState.hasOfficialCli && targetState.recoverable) {
        const stalePath = `${rootPath}.stale-${Date.now()}`;
        await fs.rename(rootPath, stalePath);
        log.push(`Quarantined incomplete Hermes install to ${stalePath}`);
      } else if (targetState.exists && !targetState.hasHermesCli && !targetState.recoverable) {
        return await finish({
          ok: false,
          rootPath,
          message: `目标目录已存在但看起来不是可自动恢复的 Hermes 安装：${rootPath}。请更换安装位置，或手动清理该目录后重试。`,
        }, "failed");
      }

      const powershell = await this.runLogged("powershell.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], process.cwd(), log, 15_000, { signal });
      if (powershell.exitCode !== 0) {
        return await finish({ ok: false, rootPath, message: "无法自动安装 Hermes：未检测到可用 PowerShell。请确认 Windows PowerShell 可启动后重试。" }, "failed");
      }

      this.throwIfAborted(signal);

      const githubSlow = await this.isGithubSlow(log);
      if (githubSlow) {
        emit("preflight", 10, "检测到 GitHub 访问较慢，建议切换国内社区镜像后重试。", "如果继续安装，脚本从 GitHub 下载依赖可能会耗时较长。可在设置中心切换安装来源为国内社区镜像，或取消后手动安装 Hermes。", { sourceUrl: installerUrls[0] });
      }

      emit("preflight", 12, "正在检查系统依赖（Git / Python）。", "如果缺失将通过 winget 自动安装，避免安装脚本在后台长时间下载。");
      const gitReady = await this.ensureGitAvailable(log, (stage, progress, message, detail) => emit(stage, progress, message, detail));
      if (!gitReady.ok) {
        return await finish({ ok: false, rootPath, message: gitReady.message }, "failed");
      }
      const pythonReady = await this.ensurePythonAvailable(log, (stage, progress, message, detail) => emit(stage, progress, message, detail));
      if (!pythonReady.ok) {
        return await finish({ ok: false, rootPath, message: pythonReady.message }, "failed");
      }

      this.throwIfAborted(signal);
      emit("downloading_script", 28, "正在下载 Hermes Windows 安装脚本。", installerUrls[0], { sourceUrl: installerUrls[0] });
      const download = await this.downloadOfficialInstallerScript(scriptPath, logDir, log, installerUrls, signal);
      if (!download.ok) {
        return await finish({ ok: false, rootPath, message: `Hermes 安装脚本下载失败：无法访问 ${installerUrls.join(" 或 ")}。请检查网络，或切换安装来源后重试。详情见安装日志：${logPath}` }, "failed");
      }
      await this.patchOfficialInstallerScript(scriptPath, log);

      this.throwIfAborted(signal);

      const executionPolicyCheck = await this.runLogged("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Write-Host 'execution-policy-ok'"], process.cwd(), log, 15_000, { signal });
      if (executionPolicyCheck.exitCode !== 0 || !executionPolicyCheck.stdout.includes("execution-policy-ok")) {
        log.push("PowerShell execution policy check failed: " + executionPolicyCheck.stderr);
        return await finish({
          ok: false,
          rootPath,
          message: `无法运行 Hermes 安装脚本：PowerShell 执行策略受限（${executionPolicyCheck.stderr.trim() || "未知错误"}）。请尝试以下方法后重试：1) 以管理员身份运行 PowerShell 执行 Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned；2) 或在设置中心切换国内社区镜像后重试；3) 或参考手动安装向导手动安装 Hermes。`,
        }, "failed");
      }

      const mirrorEnv = await this.detectPipMirror(log);
      const installerEnv: Record<string, string> | undefined = mirrorEnv
        ? {
            PIP_INDEX_URL: mirrorEnv,
            UV_INDEX_URL: mirrorEnv,
            PIP_TRUSTED_HOST: new URL(mirrorEnv).hostname,
          }
        : undefined;
      if (mirrorEnv) {
        emit("running_installer", 45, "正在运行 Hermes Windows 安装脚本（已启用国内镜像）。", rootPath, { sourceUrl: download.url });
        log.push(`Using pip/uv mirror: ${mirrorEnv}`);
      } else {
        emit("running_installer", 45, "正在运行 Hermes Windows 安装脚本。", rootPath, { sourceUrl: download.url });
      }
      const installerArgs = await this.officialInstallerArgs(scriptPath, hermesHome, rootPath);
      log.push(`Official installer args: ${installerArgs.join(" ")}`);
      let installerProgress = 45;
      const install = await this.runLogged("powershell.exe", installerArgs, logDir, log, DEFAULT_INSTALL_TIMEOUT_MS, {
        signal,
        heartbeatMs: 15_000,
        env: installerEnv,
        onHeartbeat: (elapsedSeconds) => {
          const minutes = Math.floor(elapsedSeconds / 60);
          let detail = `已等待 ${elapsedSeconds} 秒。官方脚本正在后台下载并安装依赖，这是正常现象。`;
          if (elapsedSeconds > 120) {
            detail += " 如果长时间卡住，可能是网络连接较慢、依赖源受限或 PowerShell 执行策略被组策略限制。可以展开日志定位阻塞项，或取消后切换国内社区镜像重试。";
          }
          emit("running_installer", installerProgress, minutes >= 2 ? `安装脚本仍在运行（已 ${minutes} 分钟）` : "安装脚本仍在运行，请保持网络连接。", detail);
        },
        onLine: (line) => {
          const mapped = installerProgressFromLine(line);
          installerProgress = Math.max(installerProgress, mapped.progress);
          emit("running_installer", installerProgress, mapped.message, line, { logLine: line, sourceUrl: download.url });
        },
      });
      if (signal?.aborted) {
        return await finish({ ok: false, rootPath, message: "Hermes 安装已取消。" }, "cancelled");
      }
      if (install.exitCode !== 0) {
        const diagnostic = this.installFailureMessage(install.stdout, install.stderr, logPath);
        return await finish({ ok: false, rootPath, message: diagnostic }, "failed");
      }
      if (this.officialInstallerReportedFailure(install.stdout, install.stderr)) {
        const diagnostic = this.installFailureMessage(install.stdout, install.stderr, logPath);
        return await finish({ ok: false, rootPath, message: `Hermes 安装脚本报告失败：${diagnostic}` }, "failed");
      }

      const sourceSync = await this.syncInstalledSourceIfNeeded(rootPath, installSource, log, signal);
      if (!sourceSync.ok) {
        return await finish({ ok: false, rootPath, message: `${sourceSync.message} 详情见安装日志：${logPath}` }, "failed");
      }

      emit("health_check", 82, "正在校验 Hermes 是否可启动。", rootPath);
      const localHealth = await this.checkInstalledHermes(rootPath, log);
      if (!localHealth.available) {
        return await finish({
          ok: false,
          rootPath,
          message: `Hermes 文件已落地到 ${rootPath}，但本地自检未通过：${localHealth.message}。详情见安装日志：${logPath}`,
        }, "failed");
      }
      await this.repairVenvBestEffort(rootPath, log);

      await this.verifyHermesHomeWritable(hermesHome, log);
      await this.recordManagedWindowsTools(hermesHome, log);
      const editable = await this.detectEditableInstall(rootPath, log);
      const installedCommit = await this.currentGitCommit(rootPath, log);
      await this.writeManagedMarker(rootPath, editable, installSource, installedCommit);
      const previousHermesRoot = (await this.configStore.read()).enginePaths?.hermes;
      await this.saveHermesRoot(rootPath, installSource);

      const adapterHealth = await this.hermes.healthCheck().catch((error) => {
        log.push(`Post-install adapter health check threw: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      });
      if (!adapterHealth?.available) {
        await this.restoreHermesRoot(previousHermesRoot);
        return await finish({
          ok: false,
          rootPath,
          message: `Hermes 已安装到 ${rootPath}，但客户端复检仍未通过：${adapterHealth?.message ?? "未知错误"}。详情见安装日志：${logPath}`,
        }, "failed");
      }

      return await finish({ ok: true, rootPath, message: `Hermes 已自动安装完成并通过检查：${rootPath}` }, "completed");
    } catch (error) {
      if (signal?.aborted) {
        const rootPath = await this.resolveInstallRoot(options.rootPath).catch(() => this.defaultInstallRoot());
        log.push("Install cancelled by user.");
        return await finish({
          ok: false,
          message: "Hermes 安装已取消。",
          rootPath,
        }, "cancelled");
      }
      const message = error instanceof Error ? error.message : String(error);
      log.push(`Install crashed: ${message}`);
      return await finish({
        ok: false,
        message: `Hermes 自动安装失败：${message}`,
        rootPath: await this.resolveInstallRoot(options.rootPath).catch(() => this.defaultInstallRoot()),
      }, "failed");
    }
  }

  private async repairWithOfficialInstaller(id: SetupDependencyRepairId): Promise<InstallStrategyRepairResult> {
    const rootPath = await this.resolveInstallRoot(await this.configStore.getEnginePath("hermes").catch(() => this.defaultInstallRoot()));
    const result = await this.performInstallHermes(undefined, { rootPath, mode: "windows" }, true);
    return {
      ok: result.ok,
      id,
      message: result.ok
        ? "Hermes Windows 安装脚本已重跑完成，请重新检测依赖状态。"
        : `Hermes Windows 安装脚本修复失败：${result.message}`,
      stdout: result.log.join("\n"),
      stderr: result.ok ? "" : result.message,
      logPath: result.logPath,
      recommendedFix: result.ok
        ? "重新打开系统状态页或运行一键诊断确认依赖是否就绪。"
        : "请查看安装日志；如果 winget 或网络策略不可用，请按日志中的手动命令安装缺失依赖。",
      plan: result.plan ?? await this.plan({ rootPath, mode: "windows" }),
    };
  }

  private async downloadOfficialInstallerScript(scriptPath: string, cwd: string, log: string[], urls: string[], signal?: AbortSignal) {
    for (const url of urls) {
      const downloadScript = [
        "$ProgressPreference='SilentlyContinue';",
        `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;`,
        `Invoke-WebRequest -UseBasicParsing -Uri ${psQuote(url)} -OutFile ${psQuote(scriptPath)};`,
      ].join(" ");
      const result = await this.runLogged("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", downloadScript], cwd, log, 120_000, { signal });
      if (result.exitCode === 0 && await this.exists(scriptPath)) {
        log.push(`Official installer downloaded from ${url}.`);
        return { ok: true, url };
      }
      log.push(`Installer download failed from ${url}; trying next configured source if available.`);
    }
    return { ok: false };
  }

  private async officialInstallerArgs(scriptPath: string, hermesHome: string, rootPath: string) {
    const script = await fs.readFile(scriptPath, "utf8").catch(() => "");
    const supportsWithSystemPackages = /(?:param\s*\(|,)\s*\[switch\]\s*\$WithSystemPackages\b/i.test(script);
    const supportsSkipGateway = /(?:param\s*\(|,)\s*\[switch\]\s*\$SkipGatewayStartup\b/i.test(script);
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-SkipSetup",
    ];
    if (supportsSkipGateway) {
      args.push("-SkipGatewayStartup");
    }
    if (supportsWithSystemPackages) {
      args.push("-WithSystemPackages");
    }
    args.push("-HermesHome", hermesHome, "-InstallDir", rootPath);
    return args;
  }

  private officialInstallerReportedFailure(stdout: string, stderr: string) {
    const output = `${stdout}\n${stderr}`;
    return /Installation failed:|uv installation failed|Python .* not available|Git not available and auto-install failed|Failed to download repository/i.test(output);
  }

  private installFailureMessage(stdout: string, stderr: string, logPath: string) {
    const code = this.diagnosticCodeForOutput(`${stdout}\n${stderr}`);
    const hint = diagnosticHint(code);
    return `${hint} 详情见安装日志：${logPath}`;
  }

  private installerUrlsForSource(source: InstallSource) {
    return source.sourceLabel === "mirror"
      ? [COMMUNITY_MIRROR_WINDOWS_INSTALLER_URL]
      : [OFFICIAL_WINDOWS_INSTALLER_URL];
  }

  private canReuseExistingInstallForSource(source: InstallSource) {
    return source.sourceLabel === "official" || source.sourceLabel === "mirror";
  }

  private throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("install_cancelled");
  }

  private async syncInstalledSourceIfNeeded(rootPath: string, source: InstallSource, log: string[], signal?: AbortSignal) {
    const targetBranch = source.branch?.trim() || "main";
    const isDefaultOfficial = source.repoUrl === OFFICIAL_HERMES_REPO_URL
      && source.sourceLabel !== "custom"
      && !source.commit
      && targetBranch === "main";
    if (isDefaultOfficial) {
      log.push("Install source sync skipped; official main is handled by the installer.");
      return { ok: true, message: "安装源无需额外同步。" };
    }

    this.throwIfAborted(signal);
    log.push(`Synchronizing installed Hermes source to ${source.repoUrl}@${source.commit ?? targetBranch}`);
    const commands = source.commit
      ? [
        ["remote", "set-url", "origin", source.repoUrl],
        ["fetch", "--depth", "1", "origin", source.commit],
        ["checkout", "--detach", "FETCH_HEAD"],
      ]
      : [
        ["remote", "set-url", "origin", source.repoUrl],
        ["fetch", "--depth", "1", "origin", targetBranch],
        ["checkout", targetBranch],
        ["reset", "--hard", "FETCH_HEAD"],
      ];
    for (const args of commands) {
      const result = await this.runLogged("git", args, rootPath, log, 120_000, { signal });
      if (result.exitCode !== 0) {
        return {
          ok: false,
          message: `Hermes 源同步失败：git ${args.join(" ")} 未成功。请检查仓库地址、分支/commit 和网络连接。`,
        };
      }
    }
    return { ok: true, message: "安装源已同步。" };
  }

  private diagnosticCodeForOutput(output: string) {
    if (/PowerShell|powershell/i.test(output) && /not.*found|无法|not recognized|failed/i.test(output)) return "powershell_unavailable";
    if (/Invoke-WebRequest|download.*install|安装脚本下载|Could not resolve host|timed out|TLS|SSL/i.test(output)) return "script_download_failed";
    if (/Failed to download repository|git clone|git fetch|Could not resolve host|repository not found|Authentication failed/i.test(output)) return "repo_download_failed";
    if (/uv installation failed|uv .*failed|astral|venv/i.test(output)) return "uv_or_venv_failed";
    if (/winget|Git not available and auto-install failed|Python .* not available/i.test(output)) return "system_dependency_failed";
    if (/pip|No matching distribution|Could not find a version|subprocess-exited-with-error/i.test(output)) return "pip_dependency_failed";
    if (/目标目录|not.*Hermes|recoverable|occupied|access is denied|EPERM|EACCES/i.test(output)) return "target_directory_blocked";
    if (/health|Hermes CLI|--version|capabilities|自检/i.test(output)) return "health_check_failed";
    return "install_failed";
  }

  private async repairWithWinget(id: SetupDependencyRepairId, label: string, packageId: string): Promise<InstallStrategyRepairResult> {
    const log: string[] = [];
    const startedAt = new Date().toISOString();
    const logDir = path.join(this.appPaths.baseDir(), "diagnostics", "install-logs");
    const logPath = path.join(logDir, `dependency-${id}-${startedAt.replace(/[:.]/g, "-")}.log`);
    try {
      const winget = await this.runLogged("winget", ["--version"], process.cwd(), log, 15_000);
      if (winget.exitCode !== 0) {
        const message = "未检测到 Windows 包管理器 winget，无法自动安装系统依赖。";
        await this.writeInstallLog(logDir, logPath, message, log);
        return { ok: false, id, message, stdout: winget.stdout, stderr: winget.stderr, logPath, recommendedFix: `请手动安装 ${label}，安装后重启 Hermes Forge。`, plan: await this.plan() };
      }
      const args = ["install", "--id", packageId, "-e", "--source", "winget", "--accept-source-agreements", "--accept-package-agreements"];
      const result = await this.runLogged("winget", args, process.cwd(), log, DEFAULT_INSTALL_TIMEOUT_MS);
      const ok = result.exitCode === 0;
      const message = ok ? `${label} 安装命令已执行完成，请重启 Hermes Forge 后重新检测。` : `${label} 自动安装失败，详情见修复日志：${logPath}`;
      await this.writeInstallLog(logDir, logPath, message, log);
      return {
        ok,
        id,
        message,
        command: `winget ${args.join(" ")}`,
        stdout: result.stdout,
        stderr: result.stderr,
        logPath,
        recommendedFix: ok ? "重启客户端并重新打开系统状态页确认依赖是否就绪。" : `请手动安装 ${label} 后重试。`,
        plan: await this.plan(),
      };
    } catch (error) {
      const message = `${label} 自动修复流程异常：${error instanceof Error ? error.message : String(error)}`;
      log.push(message);
      await this.writeInstallLog(logDir, logPath, message, log);
      return { ok: false, id, message, logPath, recommendedFix: `请手动安装 ${label} 后重启客户端。`, plan: await this.plan() };
    }
  }

  private async repairPythonPackage(id: SetupDependencyRepairId, label: string, packageName: string, successRecommendedFix = "请重新尝试微信扫码或刷新系统状态确认依赖已就绪。"): Promise<InstallStrategyRepairResult> {
    const log: string[] = [];
    const startedAt = new Date().toISOString();
    const logDir = path.join(this.appPaths.baseDir(), "diagnostics", "install-logs");
    const logPath = path.join(logDir, `dependency-${id}-${startedAt.replace(/[:.]/g, "-")}.log`);
    const config = await this.configStore.read().catch(() => undefined);
    const rootPath = await this.resolveInstallRoot(await this.configStore.getEnginePath("hermes").catch(() => this.defaultInstallRoot()));
    const runtime: HermesRuntimeConfig = {
      mode: "windows" as const,
      pythonCommand: config?.hermesRuntime?.pythonCommand?.trim() || "python",
      windowsAgentMode: config?.hermesRuntime?.windowsAgentMode ?? "hermes_native",
    };
    const probe = await this.runtimeProbeService?.probe({ runtime }).catch(() => undefined);
    const candidates: Array<{ command: string; args: string[]; label: string }> = [];
    const addCandidate = (command: string | undefined, argsPrefix: string[] | undefined, label: string) => {
      if (!command?.trim()) return;
      const args = [...(argsPrefix ?? []), "-m", "pip", "install", "--upgrade", packageName];
      if (!candidates.some((candidate) => candidate.command === command && candidate.args.join("\0") === args.join("\0"))) {
        candidates.push({ command, args, label });
      }
    };
    addCandidate(path.join(rootPath, "venv", "Scripts", "python.exe"), undefined, "venv Python");
    addCandidate(path.join(rootPath, ".venv", "Scripts", "python.exe"), undefined, ".venv Python");
    addCandidate(probe?.commands?.python?.command, probe?.commands?.python?.args, probe?.commands?.python?.label ?? "RuntimeProbe Python");
    let lastResult: Awaited<ReturnType<typeof runCommand>> | undefined;
    let lastCommand = "";
    for (const candidate of candidates) {
      if (looksLikeFilePath(candidate.command) && !(await this.exists(candidate.command))) {
        log.push(`${candidate.label}: 文件不存在，跳过。`);
        continue;
      }
      lastCommand = `${candidate.command} ${candidate.args.join(" ")}`;
      const result = await this.runLogged(candidate.command, candidate.args, rootPath, log, DEFAULT_INSTALL_TIMEOUT_MS);
      lastResult = result;
      if (result.exitCode === 0) {
        const message = `${label} 已安装或更新完成。`;
        await this.writeInstallLog(logDir, logPath, message, log);
        return { ok: true, id, message, command: lastCommand, stdout: result.stdout, stderr: result.stderr, logPath, recommendedFix: successRecommendedFix, plan: await this.plan() };
      }
    }
    const message = `${label} 自动安装失败，详情见修复日志：${logPath}`;
    await this.writeInstallLog(logDir, logPath, message, log);
    return {
      ok: false,
      id,
      message,
      command: lastCommand,
      stdout: lastResult?.stdout ?? "",
      stderr: lastResult?.stderr ?? "",
      logPath,
      recommendedFix: `请先重跑 Hermes Windows 安装脚本；若仍失败，请在 Hermes venv 中执行 python -m pip install ${packageName}。`,
      plan: await this.plan(),
    };
  }

  private async isGithubSlow(log: string[]): Promise<boolean> {
    try {
      const result = await this.runLogged("powershell.exe", ["-NoProfile", "-Command", "Test-Connection -ComputerName github.com -Count 2 -Quiet"], process.cwd(), log, 10_000);
      if (result.exitCode !== 0 || result.stdout.trim().toLowerCase() !== "true") {
        log.push("GitHub connectivity check: unreachable or timed out.");
        return true;
      }
      const start = Date.now();
      const httpResult = await this.runLogged("powershell.exe", ["-NoProfile", "-Command", "Invoke-WebRequest -Uri 'https://github.com' -UseBasicParsing -TimeoutSec 8 -MaximumRedirection 0; exit $LASTEXITCODE"], process.cwd(), log, 15_000);
      const elapsed = Date.now() - start;
      if (httpResult.exitCode !== 0 || elapsed > 6000) {
        log.push(`GitHub HTTP latency: ${elapsed}ms (slow or blocked).`);
        return true;
      }
      log.push(`GitHub HTTP latency: ${elapsed}ms (ok).`);
      return false;
    } catch {
      log.push("GitHub connectivity check: exception.");
      return true;
    }
  }

  private async ensureGitAvailable(log: string[], emit: (stage: Parameters<InstallPublisher>[0]["stage"], progress: number, message: string, detail?: string) => void) {
    const probe = await this.runtimeProbeService?.probe({ runtime: { mode: "windows", pythonCommand: "python", windowsAgentMode: "hermes_native" } }).catch(() => undefined);
    if (probe?.gitAvailable) {
      log.push(`RuntimeProbe Git: ${probe.commands.git.message}`);
      return { ok: true, message: "Git 可用。" };
    }
    const git = await this.runLogged("git", ["--version"], process.cwd(), log, 15_000);
    if (git.exitCode === 0) return { ok: true, message: "Git 可用。" };
    emit("repairing_dependencies", 12, "未检测到 Git，正在尝试自动安装 Git。", "将通过 winget 安装 Git.Git。");
    const repair = await this.repairWithWinget("git", "Git", "Git.Git");
    log.push(`Git repair result: ${repair.message}`);
    if (!repair.ok) {
      return { ok: false, message: `无法自动安装 Hermes：未检测到可用 Git，且自动安装 Git 失败。${repair.recommendedFix ?? "请手动安装 Git for Windows 后重启客户端。"}` };
    }
    emit("preflight", 18, "Git 安装命令已完成，正在重新检测。", repair.recommendedFix);
    const recheck = await this.runLogged("git", ["--version"], process.cwd(), log, 15_000);
    return recheck.exitCode === 0
      ? { ok: true, message: "Git 已可用。" }
      : { ok: false, message: "Git 安装命令已执行，但当前进程仍未检测到 git 命令。请重启 Hermes Forge，或手动确认 Git 已加入 PATH。" };
  }

  private async ensurePythonAvailable(log: string[], emit: (stage: Parameters<InstallPublisher>[0]["stage"], progress: number, message: string, detail?: string) => void): Promise<{ ok: true; python: PythonLauncher; message: string } | { ok: false; message: string; python?: undefined }> {
    const probe = await this.runtimeProbeService?.probe({ runtime: { mode: "windows", pythonCommand: "python", windowsAgentMode: "hermes_native" } }).catch(() => undefined);
    if (probe?.runtimeMode === "windows" && probe.commands.python.available && probe.commands.python.command) {
      const python = { command: probe.commands.python.command, argsPrefix: probe.commands.python.args ?? [], label: probe.commands.python.label ?? probe.commands.python.command };
      log.push(`RuntimeProbe Python: ${probe.commands.python.message}`);
      return { ok: true, python, message: `${python.label} 可用。` };
    }
    const detected = await this.detectPythonLauncher(log);
    if (detected) return { ok: true, python: detected, message: `${detected.label} 可用。` };
    emit("repairing_dependencies", 20, "未检测到 Python，正在尝试自动安装 Python。", "将通过 winget 安装 Python.Python.3.12。");
    const repair = await this.repairWithWinget("python", "Python", "Python.Python.3.12");
    log.push(`Python repair result: ${repair.message}`);
    if (!repair.ok) {
      return { ok: false, message: `无法自动安装 Hermes：未检测到可用 Python，且自动安装 Python 失败。${repair.recommendedFix ?? "请手动安装 Python 后重启客户端。"}` };
    }
    emit("preflight", 26, "Python 安装命令已完成，正在重新检测。", repair.recommendedFix);
    const recheck = await this.detectPythonLauncher(log);
    return recheck
      ? { ok: true, python: recheck, message: `${recheck.label} 已可用。` }
      : { ok: false, message: "Python 安装命令已执行，但当前进程仍未检测到 python/py 命令。请重启 Hermes Forge，或手动确认 Python 已加入 PATH。" };
  }

  private async detectPythonLauncher(log: string[]): Promise<PythonLauncher | undefined> {
    const candidates: PythonLauncher[] = [
      { command: "python", argsPrefix: [], label: "python" },
      { command: "py", argsPrefix: ["-3"], label: "py -3" },
      ...getWindowsPythonInstallCandidates("win32").map((command) => ({ command, argsPrefix: [], label: command })),
    ];
    for (const candidate of candidates) {
      if (path.isAbsolute(candidate.command) && !(await this.exists(candidate.command))) continue;
      const result = await this.runLogged(candidate.command, [...candidate.argsPrefix, "--version"], process.cwd(), log, 15_000);
      if (result.exitCode === 0) return candidate;
    }
    return undefined;
  }

  private async installPythonDependencies(rootPath: string, log: string[], python: PythonLauncher, emit?: (stage: Parameters<InstallPublisher>[0]["stage"], progress: number, message: string, detail?: string) => void) {
    if (await this.exists(path.join(rootPath, "pyproject.toml"))) {
      const result = await this.runLogged(python.command, [...python.argsPrefix, "-m", "pip", "install", "-e", "."], rootPath, log, DEFAULT_INSTALL_TIMEOUT_MS, {
        heartbeatMs: 15_000,
        onHeartbeat: (elapsedSeconds) => emit?.("installing_dependencies", 68, "仍在安装 Hermes Python 依赖。", `已等待 ${elapsedSeconds} 秒，使用 ${python.label}`),
      });
      if (result.exitCode !== 0) log.push("Editable pip install failed; continuing to health check so the user gets a precise runtime error.");
      return;
    }
    if (await this.exists(path.join(rootPath, "requirements.txt"))) {
      const result = await this.runLogged(python.command, [...python.argsPrefix, "-m", "pip", "install", "-r", "requirements.txt"], rootPath, log, DEFAULT_INSTALL_TIMEOUT_MS, {
        heartbeatMs: 15_000,
        onHeartbeat: (elapsedSeconds) => emit?.("installing_dependencies", 68, "仍在安装 Hermes Python 依赖。", `已等待 ${elapsedSeconds} 秒，使用 ${python.label}`),
      });
      if (result.exitCode !== 0) log.push("requirements.txt pip install failed; continuing to health check so the user gets a precise runtime error.");
    }
  }

  private async repairVenvBestEffort(rootPath: string, log: string[]) {
    if (await this.hasVenv(rootPath)) {
      log.push("Hermes venv already exists.");
      return;
    }
    log.push("Hermes venv not found; attempting best-effort repair.");
    const uv = await this.runLogged("uv", ["--version"], rootPath, log, 15_000).catch(() => undefined);
    if (uv?.exitCode === 0) {
      const sync = await this.runLogged("uv", ["sync"], rootPath, log, DEFAULT_INSTALL_TIMEOUT_MS).catch(() => undefined);
      if (sync?.exitCode === 0 && await this.hasVenv(rootPath)) {
        log.push("Hermes venv repaired through uv sync.");
        return;
      }
      const pip = await this.runLogged("uv", ["pip", "install", "-e", "."], rootPath, log, DEFAULT_INSTALL_TIMEOUT_MS).catch(() => undefined);
      if (pip?.exitCode === 0 && await this.hasVenv(rootPath)) {
        log.push("Hermes venv repaired through uv pip install -e .");
        return;
      }
    }
    const python = await this.detectPythonLauncher(log);
    if (!python) {
      log.push("No system Python available for venv repair; leaving source CLI as fallback.");
      return;
    }
    const venvDir = path.join(rootPath, "venv");
    const create = await this.runLogged(python.command, [...python.argsPrefix, "-m", "venv", venvDir], rootPath, log, DEFAULT_INSTALL_TIMEOUT_MS).catch(() => undefined);
    if (create?.exitCode !== 0) {
      log.push("python -m venv failed; leaving source CLI as fallback.");
      return;
    }
    const venvPython = path.join(venvDir, "Scripts", "python.exe");
    if (await this.exists(venvPython)) {
      const install = await this.runLogged(venvPython, ["-m", "pip", "install", "-e", "."], rootPath, log, DEFAULT_INSTALL_TIMEOUT_MS).catch(() => undefined);
      if (install?.exitCode === 0) log.push("Hermes venv repaired through python -m venv + pip install -e .");
      else log.push("venv pip install failed; source CLI remains usable when health check passes.");
    }
  }

  private async saveHermesRoot(rootPath: string, installSource?: InstallSource) {
    const config = await this.configStore.read();
    const source = installSource ?? resolveInstallSource(config);
    await this.configStore.write({
      ...config,
      enginePaths: { ...(config.enginePaths ?? {}), hermes: rootPath },
      hermesRuntime: {
        ...(config.hermesRuntime ?? {}),
        mode: "windows",
        distro: undefined,
        managedRoot: rootPath,
        installSource: {
          repoUrl: source.repoUrl,
          branch: source.branch ?? "main",
          commit: source.commit,
          sourceLabel: source.sourceLabel,
        },
      },
    });
  }

  private async restoreHermesRoot(previousRootPath?: string) {
    const config = await this.configStore.read();
    const nextEnginePaths = { ...(config.enginePaths ?? {}) };
    if (previousRootPath?.trim()) nextEnginePaths.hermes = previousRootPath;
    else delete nextEnginePaths.hermes;
    await this.configStore.write({ ...config, enginePaths: nextEnginePaths });
  }

  private async syncHermesGitRepository(rootPath: string, log: string[]): Promise<GitSyncResult> {
    const repo = await this.runLogged("git", ["rev-parse", "--is-inside-work-tree"], rootPath, log, 15_000);
    if (repo.exitCode !== 0 || repo.stdout.trim() !== "true") {
      return {
        ok: false,
        message: "Hermes 更新失败：当前安装目录不是有效 Git 仓库，无法通过 Git 同步代码。请重新安装 Hermes Agent。",
      };
    }

    const headBefore = await this.gitText(rootPath, ["rev-parse", "--short", "HEAD"], log);
    const branchResult = await this.runLogged("git", ["branch", "--show-current"], rootPath, log, 15_000);
    const currentBranch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : "";
    if (!currentBranch) {
      return {
        ok: false,
        currentCommit: headBefore,
        message: "Hermes 更新失败：当前仓库处于 detached HEAD，无法安全执行 git pull。请重新安装 Hermes Agent，或手动 checkout 到目标分支后重试。",
      };
    }

    const fetch = await this.runLogged("git", ["fetch", "origin", "--prune"], rootPath, log, 120_000);
    if (fetch.exitCode !== 0) {
      return {
        ok: false,
        branch: currentBranch,
        currentCommit: headBefore,
        message: "Hermes 更新失败：无法从 origin 获取最新代码，请检查网络连接或远程仓库配置。",
      };
    }

    const remoteRef = `origin/${currentBranch}`;
    const latestCommit = await this.gitText(rootPath, ["rev-parse", "--short", remoteRef], log);
    if (!latestCommit) {
      return {
        ok: false,
        branch: currentBranch,
        remoteRef,
        currentCommit: headBefore,
        message: `Hermes 更新失败：远程分支 ${remoteRef} 不存在，请检查安装源分支配置。`,
      };
    }

    const behindBefore = await this.gitCount(rootPath, ["rev-list", `HEAD..${remoteRef}`, "--count"], log);
    if (behindBefore === undefined) {
      return {
        ok: false,
        branch: currentBranch,
        remoteRef,
        currentCommit: headBefore,
        latestCommit,
        message: `Hermes 更新失败：无法比较本地 HEAD 与 ${remoteRef}。`,
      };
    }

    if (behindBefore > 0) {
      const pull = await this.runLogged("git", ["pull", "--ff-only", "origin", currentBranch], rootPath, log, 120_000);
      if (pull.exitCode !== 0) {
        return {
          ok: false,
          branch: currentBranch,
          remoteRef,
          currentCommit: headBefore,
          latestCommit,
          behindBefore,
          message: `Hermes 更新失败：git pull origin ${currentBranch} 未成功，可能存在本地修改、分支分叉或网络问题。请处理冲突后重试。`,
        };
      }
    } else {
      log.push(`Git sync skipped pull because HEAD is already aligned with ${remoteRef}.`);
    }

    const behindAfter = await this.gitCount(rootPath, ["rev-list", `HEAD..${remoteRef}`, "--count"], log);
    if (behindAfter === undefined || behindAfter > 0) {
      return {
        ok: false,
        branch: currentBranch,
        remoteRef,
        currentCommit: await this.gitText(rootPath, ["rev-parse", "--short", "HEAD"], log) ?? headBefore,
        latestCommit,
        behindBefore,
        behindAfter,
        message: `Hermes 更新后仍有 ${behindAfter ?? "未知数量"} 个提交未同步，请检查本地仓库状态后重试。`,
      };
    }

    return {
      ok: true,
      branch: currentBranch,
      remoteRef,
      currentCommit: await this.gitText(rootPath, ["rev-parse", "--short", "HEAD"], log) ?? headBefore,
      latestCommit,
      behindBefore,
      behindAfter,
    };
  }

  private async gitText(rootPath: string, args: string[], log: string[]) {
    const result = await this.runLogged("git", args, rootPath, log, 15_000);
    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
  }

  private async gitCount(rootPath: string, args: string[], log: string[]) {
    const text = await this.gitText(rootPath, args, log);
    if (text === undefined) return undefined;
    const count = Number.parseInt(text, 10);
    return Number.isFinite(count) ? count : undefined;
  }

  private async runLogged(command: string, args: string[], cwd: string, log: string[], timeoutMs: number, heartbeat?: { heartbeatMs?: number; onHeartbeat?: (elapsedSeconds: number) => void; signal?: AbortSignal; onLine?: (line: string) => void; env?: Record<string, string> }) {
    log.push(`$ ${command} ${args.join(" ")}`);
    const startedAt = Date.now();
    const timer = heartbeat?.heartbeatMs && heartbeat.onHeartbeat ? setInterval(() => {
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      log.push(`[heartbeat] ${command} still running after ${elapsedSeconds}s`);
      heartbeat.onHeartbeat?.(elapsedSeconds);
    }, heartbeat.heartbeatMs) : undefined;
    try {
      if (!heartbeat?.onLine) {
        const result = await runCommand(command, args, { cwd, timeoutMs, signal: heartbeat?.signal, env: heartbeat?.env });
        if (result.stdout.trim()) log.push(result.stdout.trim());
        if (result.stderr.trim()) log.push(result.stderr.trim());
        log.push(`exit ${result.exitCode ?? "unknown"}`);
        return result;
      }

      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      for await (const event of streamCommand(command, args, { cwd, timeoutMs, signal: heartbeat.signal, env: heartbeat.env })) {
        if (event.type === "stdout" || event.type === "stderr") {
          const line = event.line.trim();
          if (!line) continue;
          if (event.type === "stdout") stdout += `${line}\n`;
          else stderr += `${line}\n`;
          log.push(line);
          heartbeat.onLine(line);
        } else {
          exitCode = event.exitCode;
        }
      }
      log.push(`exit ${exitCode ?? "unknown"}`);
      return { exitCode, stdout, stderr };
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  private async inspectTargetDirectory(rootPath: string, log: string[]) {
    try {
      const entries = await fs.readdir(rootPath);
      const hasHermesCli = Boolean(await resolveHermesCliPath(rootPath));
      const hasOfficialCli = await this.exists(path.join(rootPath, "venv", "Scripts", "hermes.exe"))
        || await this.exists(path.join(rootPath, ".venv", "Scripts", "hermes.exe"));
      const marker = await this.exists(path.join(rootPath, ".zhenghebao-managed-install.json"));
      const recoverableSignals = [".git", ".zhenghebao-managed-install.json", "pyproject.toml", "requirements.txt", "README.md"];
      const recoverable = entries.some((entry) => recoverableSignals.includes(entry));
      return { exists: true, isEmpty: entries.length === 0, hasHermesCli, hasOfficialCli, recoverable: marker || recoverable };
    } catch (error) {
      const code = this.errorCode(error);
      if (code === "ENOENT") return { exists: false, isEmpty: true, hasHermesCli: false, hasOfficialCli: false, recoverable: false };
      throw new Error(`无法访问安装目录 ${rootPath}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async assertWritableDirectory(targetPath: string, label: string, log: string[]) {
    try {
      await fs.mkdir(targetPath, { recursive: true });
      const probe = path.join(targetPath, `.zhenghebao-install-probe-${Date.now()}`);
      await fs.writeFile(probe, "ok", "utf8");
      await fs.unlink(probe);
      log.push(`${label} 可写：${targetPath}`);
    } catch (error) {
      throw new Error(`${label} 不可写：${targetPath}。${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  private async detectSourceMismatch(rootPath: string, currentSource: InstallSource): Promise<{ stale: boolean; reason?: string }> {
    const markerPath = path.join(rootPath, ".zhenghebao-managed-install.json");
    const raw = await fs.readFile(markerPath, "utf8").catch(() => undefined);
    if (!raw) return { stale: false };
    try {
      const marker = JSON.parse(raw) as { repoUrl?: string; commit?: string };
      const repoMismatch = marker.repoUrl && marker.repoUrl !== currentSource.repoUrl;
      const commitMismatch = Boolean(currentSource.commit) && marker.commit !== currentSource.commit;
      if (repoMismatch || commitMismatch) {
        return {
          stale: true,
          reason: `Detected stale install: source moved from ${marker.repoUrl ?? "unknown"}@${marker.commit ?? "unknown"} to ${currentSource.repoUrl}@${currentSource.commit ?? currentSource.branch ?? "main"}`,
        };
      }
      return { stale: false };
    } catch {
      return { stale: false };
    }
  }

  private async checkInstalledHermes(rootPath: string, log: string[], preferredPython?: PythonLauncher) {
    const cliPath = await resolveHermesCliPath(rootPath) ?? defaultHermesCliPath(rootPath);
    if (!(await this.exists(cliPath))) return { available: false, message: `未找到 Hermes CLI：${cliPath}` };
    const hermesHome = await resolveActiveHermesHome(this.appPaths.hermesDir());
    const candidates: Array<{ command: string; args: string[] }> = [
      ...(isHermesCliExecutable(cliPath) ? [{ command: cliPath, args: ["--version"] as string[] }] : []),
      ...(preferredPython ? [{ command: preferredPython.command, args: [...preferredPython.argsPrefix, cliPath, "--version"] }] : []),
      { command: path.join(rootPath, "venv", "Scripts", "python.exe"), args: [cliPath, "--version"] },
      { command: path.join(rootPath, ".venv", "Scripts", "python.exe"), args: [cliPath, "--version"] },
      { command: path.join(rootPath, "venv", "bin", "python"), args: [cliPath, "--version"] },
      { command: path.join(rootPath, ".venv", "bin", "python"), args: [cliPath, "--version"] },
      { command: "python", args: [cliPath, "--version"] },
      { command: "python3", args: [cliPath, "--version"] },
      { command: "py", args: ["-3", cliPath, "--version"] },
    ];
    let lastMessage = "未找到可用 Python 解释器。";
    for (const candidate of candidates) {
      if (path.isAbsolute(candidate.command) && !(await this.exists(candidate.command))) continue;
      const result = await runCommand(candidate.command, candidate.args, {
        cwd: rootPath,
        timeoutMs: 20_000,
        env: {
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
          PYTHONUNBUFFERED: "1",
          PYTHONPATH: `${rootPath}${path.delimiter}${process.env.PYTHONPATH ?? ""}`,
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          HERMES_HOME: hermesHome,
        },
      });
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      log.push(`Install health via ${candidate.command}: ${output || `exit ${result.exitCode ?? "unknown"}`}`);
      if (result.exitCode === 0 && output.length > 0) {
        if (this.runtimeAdapterFactory) {
          const adapter = this.runtimeAdapterFactory({
            mode: "windows",
            pythonCommand: preferredPython?.command ?? "python",
            windowsAgentMode: "hermes_native",
          });
          const validation = await validateNativeHermesCli(adapter, cliPath);
          if (!validation.ok) {
            const officialWindowsUsable = validation.kind === "capability_unsupported"
              && validation.capabilities?.cliVersion
              && validation.capabilities.supportsResume === true;
            log.push(`Capability check ${officialWindowsUsable ? "warned" : "failed"}: ${validation.message}`);
            if (!officialWindowsUsable) {
              return {
                available: false,
                message: `已安装 Hermes 但缺少 Forge 任务所需能力。${validation.message}`,
              };
            }
            log.push("Official Windows Hermes is usable for Forge task compatibility; enhanced launch metadata remains a warning.");
            return { available: true, message: `${output}\n${validation.message}` };
          }
          log.push(`Capability check passed: ${validation.capabilities.cliVersion ?? "unknown"}`);
        }
        return { available: true, message: output || "Hermes CLI 可启动。" };
      }
      lastMessage = output || (
        result.exitCode === 0
          ? `${candidate.command} 成功退出但没有输出 Hermes 版本信息，可能只是残留占位文件。`
          : `${candidate.command} 退出码 ${result.exitCode ?? "unknown"}`
      );
    }
    return { available: false, message: lastMessage };
  }

  private async detectEditableInstall(rootPath: string, log: string[]): Promise<boolean> {
    const candidates = [
      path.join(rootPath, "venv", "Scripts", "python.exe"),
      path.join(rootPath, ".venv", "Scripts", "python.exe"),
    ];
    for (const python of candidates) {
      if (!(await this.exists(python))) continue;
      const result = await runCommand(python, ["-c", "import importlib.util; spec = importlib.util.find_spec('hermes'); print(spec.origin if spec else '')"], {
        cwd: rootPath,
        timeoutMs: 10_000,
      }).catch(() => undefined);
      if (result?.exitCode === 0) {
        const origin = result.stdout.trim();
        const isEditable = origin.toLowerCase().startsWith(rootPath.toLowerCase());
        log.push(`Editable install check via ${python}: hermes at ${origin}, editable=${isEditable}`);
        return isEditable;
      }
    }
    log.push("Editable install check: no venv Python available to probe.");
    return false;
  }

  private async detectPipMirror(log: string[]): Promise<string | undefined> {
    const mirrors = [
      { url: "https://pypi.tuna.tsinghua.edu.cn/simple", label: "清华" },
      { url: "https://mirrors.aliyun.com/pypi/simple", label: "阿里云" },
      { url: "https://pypi.mirrors.ustc.edu.cn/simple", label: "中科大" },
    ];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const start = Date.now();
      await fetch("https://pypi.org/simple/", { method: "HEAD", signal: controller.signal });
      clearTimeout(timer);
      const elapsed = Date.now() - start;
      if (elapsed < 2000) {
        log.push(`PyPI official is fast (${elapsed}ms), using default index.`);
        return undefined;
      }
      log.push(`PyPI official is slow (${elapsed}ms), probing mirrors...`);
    } catch {
      log.push("PyPI official is unreachable, probing mirrors...");
    }

    for (const mirror of mirrors) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const start = Date.now();
        await fetch(mirror.url, { method: "HEAD", signal: controller.signal });
        clearTimeout(timer);
        const elapsed = Date.now() - start;
        log.push(`Mirror ${mirror.label} is available (${elapsed}ms).`);
        return mirror.url;
      } catch {
        log.push(`Mirror ${mirror.label} probe failed.`);
      }
    }
    log.push("All mirrors unreachable, falling back to default index.");
    return undefined;
  }

  private async writeManagedMarker(rootPath: string, editable: boolean, installSource?: InstallSource, installedCommit?: string) {
    const source = installSource ?? DEFAULT_PINNED_HERMES_SOURCE;
    const markerPath = path.join(rootPath, ".zhenghebao-managed-install.json");
    await fs.writeFile(markerPath, JSON.stringify({
      source: "zhenghebao",
      installer: this.installerUrlsForSource(source)[0],
      repoUrl: source.repoUrl,
      branch: source.branch ?? "main",
      commit: source.commit,
      installedCommit,
      sourceLabel: source.sourceLabel,
      editable,
      installedAt: new Date().toISOString(),
    }, null, 2), "utf8");
  }

  private async currentGitCommit(rootPath: string, log: string[]) {
    const result = await this.runLogged("git", ["rev-parse", "HEAD"], rootPath, log, 15_000).catch(() => undefined);
    const commit = result?.exitCode === 0 ? result.stdout.trim() : "";
    if (commit) {
      log.push(`Installed commit: ${commit}`);
      return commit;
    }
    log.push("Installed commit could not be resolved.");
    return undefined;
  }

  private async writeInstallLog(logDir: string, logPath: string, message: string, log: string[]) {
    try {
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(logPath, [message, "", ...log].join("\n"), "utf8");
    } catch {
      // Logging failures should not hide install result.
    }
  }

  private async cleanupDirectory(targetPath: string, log: string[]) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      log.push(`Cleaned up ${targetPath}`);
    } catch (error) {
      log.push(`Failed to clean up ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async resolveHermesCliPath(rootPath: string) {
    return await resolveHermesCliPath(rootPath) ?? defaultHermesCliPath(rootPath);
  }

  private async verifyHermesHomeWritable(hermesHome: string, log: string[]) {
    await fs.mkdir(path.join(hermesHome, "skills"), { recursive: true });
    const probe = path.join(hermesHome, "skills", `.zhenghebao-skill-write-probe-${Date.now()}`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe);
    await fs.mkdir(path.join(hermesHome, "logs"), { recursive: true });
    log.push(`Hermes home 可写：${hermesHome}`);
  }

  private async recordManagedWindowsTools(hermesHome: string, log: string[]) {
    if (process.platform !== "win32") return;
    const gitRoot = path.join(hermesHome, "git");
    const pathEntries = [
      path.join(gitRoot, "cmd"),
      path.join(gitRoot, "bin"),
      path.join(gitRoot, "usr", "bin"),
    ];
    const existingPathEntries: string[] = [];
    for (const entry of pathEntries) {
      if (await this.exists(entry)) existingPathEntries.push(entry);
    }
    if (existingPathEntries.length) {
      this.prependProcessPath(existingPathEntries);
      log.push(`Added managed Git paths to current process PATH: ${existingPathEntries.join(";")}`);
    }

    const bashCandidates = [
      path.join(gitRoot, "bin", "bash.exe"),
      path.join(gitRoot, "usr", "bin", "bash.exe"),
    ];
    const bashPath = await this.firstExistingPath(bashCandidates);
    if (bashPath) {
      process.env.HERMES_GIT_BASH_PATH = bashPath;
      log.push(`Detected managed Git Bash: ${bashPath}`);
      const persist = await this.runLogged(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `[Environment]::SetEnvironmentVariable('HERMES_GIT_BASH_PATH', ${psQuote(bashPath)}, 'User')`,
        ],
        process.cwd(),
        log,
        15_000,
      ).catch(() => undefined);
      if (persist?.exitCode === 0) log.push("Persisted HERMES_GIT_BASH_PATH for future launches.");
    }
  }

  private async hasVenv(rootPath: string) {
    return await this.exists(path.join(rootPath, "venv", "Scripts", "python.exe"))
      || await this.exists(path.join(rootPath, ".venv", "Scripts", "python.exe"))
      || await this.exists(path.join(rootPath, "venv", "Scripts", "hermes.exe"))
      || await this.exists(path.join(rootPath, ".venv", "Scripts", "hermes.exe"));
  }

  private defaultInstallRoot() {
    if (process.platform === "win32") {
      return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "hermes", "hermes-agent");
    }
    return path.join(os.homedir(), "Hermes Agent");
  }

  private defaultHermesHomeForInstall(rootPath: string) {
    return this.windowsUsablePath(process.env.HERMES_HOME?.trim())
      || this.windowsUsablePath(process.env.HERMES_AGENT_HOME?.trim())
      || path.dirname(rootPath);
  }

  private async resolveInstallRoot(requestedRoot?: string, log?: string[]) {
    const rootPath = this.windowsUsablePath(requestedRoot?.trim())
      || this.windowsUsablePath(process.env.HERMES_INSTALL_DIR?.trim())
      || this.defaultInstallRoot();
    return await this.normalizeInstallRoot(rootPath, log);
  }

  private windowsUsablePath(candidate?: string) {
    if (!candidate) return undefined;
    if (process.platform === "win32" && isLegacyPosixPath(candidate)) return undefined;
    return candidate;
  }

  private async normalizeInstallRoot(rootPath: string, log?: string[]) {
    if (process.platform !== "win32") return rootPath;
    const normalized = path.resolve(rootPath);
    const childInstall = path.join(normalized, "hermes-agent");
    if (this.samePath(normalized, childInstall)) return rootPath;

    const currentLooksInstall = await this.exists(path.join(normalized, "pyproject.toml"))
      || await this.exists(path.join(normalized, "run_agent.py"))
      || await this.exists(path.join(normalized, "venv", "Scripts", "hermes.exe"))
      || await this.exists(path.join(normalized, ".venv", "Scripts", "hermes.exe"));
    if (currentLooksInstall) return rootPath;

    const childLooksInstall = await this.exists(path.join(childInstall, "pyproject.toml"))
      || await this.exists(path.join(childInstall, "run_agent.py"))
      || await this.exists(path.join(childInstall, "venv", "Scripts", "hermes.exe"))
      || await this.exists(path.join(childInstall, ".venv", "Scripts", "hermes.exe"));
    const currentLooksHome = await this.exists(path.join(normalized, "config.yaml"))
      || await this.exists(path.join(normalized, "state.db"))
      || await this.exists(path.join(normalized, "memories"))
      || await this.exists(path.join(normalized, "skills"))
      || await this.exists(path.join(normalized, "profiles"));
    if (currentLooksHome || childLooksInstall) {
      log?.push(`Install root normalized from Hermes home to agent directory: ${normalized} -> ${childInstall}`);
      return childInstall;
    }
    return rootPath;
  }

  private async patchOfficialInstallerScript(scriptPath: string, log: string[]) {
    const raw = await fs.readFile(scriptPath, "utf8");
    const withoutBom = raw.replace(/^﻿/, "");
    // 不再替换 Start-GatewayIfConfigured，保持官方脚本原样。Forge 通过 hermes gateway run --replace 接管。
    await fs.writeFile(scriptPath, `﻿${withoutBom}`, "utf8");
    log.push("Official installer: preserved original script with UTF-8 BOM for Windows PowerShell 5.1 compatibility.");
  }

  private samePath(left: string, right: string) {
    return path.resolve(left).replace(/[\\/]+$/, "").toLowerCase() === path.resolve(right).replace(/[\\/]+$/, "").toLowerCase();
  }

  private errorCode(error: unknown) {
    return typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  }

  private async exists(targetPath: string) {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async firstExistingPath(paths: string[]) {
    for (const candidate of paths) {
      if (await this.exists(candidate)) return candidate;
    }
    return undefined;
  }

  private prependProcessPath(entries: string[]) {
    const key = process.platform === "win32" ? "Path" : "PATH";
    const current = process.env[key] ?? process.env.PATH ?? "";
    const currentItems = current.split(path.delimiter).filter(Boolean);
    const normalized = new Set(currentItems.map((item) => path.resolve(item).toLowerCase()));
    const nextEntries = entries.filter((entry) => !normalized.has(path.resolve(entry).toLowerCase()));
    if (nextEntries.length) {
      process.env[key] = [...nextEntries, ...currentItems].join(path.delimiter);
      if (key !== "PATH") process.env.PATH = process.env[key];
    }
  }
}

function looksLikeFilePath(value: string) {
  return path.isAbsolute(value) || /[\\/]/.test(value);
}

function diagnosticHint(code: string) {
  switch (code) {
    case "powershell_unavailable":
      return "PowerShell 不可用或被策略拦截，请确认 powershell.exe 可启动后重试。";
    case "script_download_failed":
      return "安装脚本下载失败，请检查网络、代理或切换安装来源。";
    case "repo_download_failed":
      return "Hermes 仓库下载失败，请检查 GitHub 访问、仓库地址、分支/commit 或代理设置。";
    case "uv_or_venv_failed":
      return "uv 或 Python 虚拟环境创建失败，请检查 Python、磁盘权限和依赖下载网络。";
    case "system_dependency_failed":
      return "Git/Python/winget 等系统依赖安装失败，请手动安装缺失依赖或重启客户端后重试。";
    case "pip_dependency_failed":
      return "Python 依赖安装失败，请检查 pip 网络源、Python 版本和安装目录权限。";
    case "target_directory_blocked":
      return "安装目录被占用或不是可恢复的 Hermes 安装，请更换空目录或清理残留后重试。";
    case "health_check_failed":
      return "Hermes 文件已落地但 CLI 自检失败，请查看日志中的 --version/capabilities 输出。";
    default:
      return "Hermes 安装脚本执行失败，请展开实时日志定位阻塞项。";
  }
}

function installerProgressFromLine(line: string) {
  const text = line.trim();
  if (/checking .*uv|installing uv|uv python install|python 3\.11|checking python|downloading uv|extracting uv/i.test(text)) {
    return { progress: 50, message: "正在准备 uv / Python 环境。" };
  }
  if (/Git not found|PortableGit|MinGit|HERMES_GIT_BASH_PATH|Checking Git|Installing Git|downloading .*Git|extracting.*Git/i.test(text)) {
    return { progress: 56, message: "正在准备 Git / Git Bash 工具链。" };
  }
  if (/Checking Node|Node\.js|Installing Node|Downloading Node|npm|Installing.*browser/i.test(text)) {
    return { progress: 62, message: "正在准备 Node.js 与浏览器工具依赖。" };
  }
  if (/ripgrep|ffmpeg|system packages|winget|chocolatey|scoop|downloading.*package|extracting.*package/i.test(text)) {
    return { progress: 67, message: "正在准备 ripgrep / ffmpeg 等系统工具。" };
  }
  if (/download.*repository|clone|submodule|fetch|checkout|Hermes repository|git.*clone|git.*pull/i.test(text)) {
    return { progress: 72, message: "正在下载或同步 Hermes 仓库。" };
  }
  if (/Installing Hermes|uv sync|pip install|Installing Python dependencies|venv|editable install|pip.*hermes/i.test(text)) {
    return { progress: 78, message: "正在安装 Hermes Python 依赖。" };
  }
  if (/setup wizard|Skipping setup|gateway|Start messaging gateway|setup.*complete/i.test(text)) {
    return { progress: 86, message: "正在完成 Hermes 设置收尾。" };
  }
  if (/Installation complete|successfully|Next steps|Hermes is ready|All done|Enjoy|completed/i.test(text)) {
    return { progress: 90, message: "安装脚本已完成，正在等待 Forge 复检。" };
  }
  if (/error|fail|exception|timeout|cannot|unable|denied|blocked|abort/i.test(text)) {
    return { progress: 55, message: "安装脚本可能遇到问题，正在继续观察。" };
  }
  return { progress: 55, message: "安装脚本正在输出日志。" };
}

function isLegacyPosixPath(value: string) {
  return /^\/(?:root|home|mnt|tmp|var|usr|etc)(?:\/|$)/i.test(value.replace(/\\/g, "/"));
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
