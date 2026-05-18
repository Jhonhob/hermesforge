import fs from "node:fs/promises";
import path from "node:path";
import type { AppPaths } from "../main/app-paths";
import type { RuntimeConfigStore } from "../main/runtime-config";
import type { EngineAdapter } from "../adapters/engine-adapter";
import type { SecretVault } from "../auth/secret-vault";
import type { WorkspaceLock } from "./workspace-lock";
import { resolveEnginePermissions } from "../shared/types";
import type { AppError, StartTaskInput } from "../shared/types";
import { missingSecretMessage, normalizeOpenAiCompatibleBaseUrl, requiresStoredSecret } from "../shared/model-config";
import type { RuntimeAdapterFactory } from "../runtime/runtime-adapter";
import type { RuntimePreflightResult } from "../runtime/runtime-types";
import { summarizePreflightFailure } from "../runtime/runtime-preflight";

export class TaskPreflightService {
  private healthCache?: { checkedAt: number; health: Awaited<ReturnType<EngineAdapter["healthCheck"]>> };
  private runtimePreflightCache?: {
    checkedAt: number;
    key: string;
    result: RuntimePreflightResult;
  };

  constructor(
    private readonly appPaths: AppPaths,
    private readonly workspaceLock: WorkspaceLock,
    private readonly hermes: EngineAdapter,
    private readonly configStore: RuntimeConfigStore,
    private readonly secretVault: SecretVault,
    private readonly runtimeAdapterFactory?: RuntimeAdapterFactory,
  ) {}

  invalidateCaches() {
    this.healthCache = undefined;
    this.runtimePreflightCache = undefined;
  }

  async assertCanStart(input: StartTaskInput, _routeEngine: "hermes", workspaceId: string) {
    const targetPath = input.workspacePath?.trim() || input.sessionFilesPath;
    await this.assertWorkspace(targetPath, this.requiresWorkspace(input));
    if (this.workspaceLock.isLocked(workspaceId)) {
      throw this.appError("WORKSPACE_LOCKED", "工作区正在被占用", "当前工作区已有 Hermes 任务运行，请等待完成或停止后再试。");
    }

    const [_, health] = await Promise.all([
      Promise.all([
        this.assertModel(input.modelProfileId),
        this.assertHermesPermissions(input),
        this.assertRuntimePreflight(input),
      ]),
      this.getCachedHealth(),
    ]);
    if (!health.available) {
      throw this.appError("ENGINE_NOT_READY", "Hermes 不可用", health.message, "configure_hermes");
    }
    await fs.mkdir(this.appPaths.workspaceSnapshotDir(workspaceId), { recursive: true });
  }

  private async assertRuntimePreflight(input: StartTaskInput) {
    if (!this.runtimeAdapterFactory) return;
    const config = await this.configStore.read();
    const runtime = {
      mode: config.hermesRuntime?.mode ?? "windows" as const,
      distro: config.hermesRuntime?.distro?.trim() || undefined,
      pythonCommand: config.hermesRuntime?.pythonCommand?.trim() || "python3",
      windowsAgentMode: config.hermesRuntime?.windowsAgentMode ?? "hermes_native" as const,
    };
    const key = this.runtimePreflightCacheKey(config, input);
    const cached = this.runtimePreflightCache;
    const result = cached && cached.key === key && Date.now() - cached.checkedAt < 15_000
      ? cached.result
      : await this.runtimeAdapterFactory(runtime).preflight({
        workspacePath: input.workspacePath?.trim() || input.sessionFilesPath,
        requireBridge: true,
      });
    if (result !== cached?.result) {
      this.runtimePreflightCache = { checkedAt: Date.now(), key, result };
    }
    if (!result.ok) {
      const failure = summarizePreflightFailure(result);
      throw this.appError(
        failure.code === "hermes_root_missing" || failure.code === "hermes_cli_missing" ? "INSTALL_REQUIRED" : "ENGINE_NOT_READY",
        failure.title,
        failure.message,
        failure.code === "hermes_root_missing" || failure.code === "hermes_cli_missing" ? "install_hermes" : "open_settings",
      );
    }
  }

  private runtimePreflightCacheKey(config: Awaited<ReturnType<RuntimeConfigStore["read"]>>, input: StartTaskInput) {
    const runtime = config.hermesRuntime;
    return [
      input.workspacePath?.trim() || input.sessionFilesPath,
      runtime?.mode ?? "windows",
      runtime?.distro?.trim() ?? "",
      runtime?.pythonCommand?.trim() ?? "python3",
      runtime?.managedRoot?.trim() ?? "",
      runtime?.windowsAgentMode ?? "hermes_native",
      input.modelProfileId ?? "",
    ].join("\0");
  }

  private async assertHermesPermissions(input: StartTaskInput) {
    const config = await this.configStore.read();
    const permissions = resolveEnginePermissions(config, "hermes");
    if (!permissions.enabled) {
      throw this.appError("ENGINE_NOT_READY", "Hermes 已被禁用", "请在 Hermes Arsenal 中重新启用该引擎。", "open_settings");
    }
    if (input.workspacePath?.trim() && !permissions.workspaceRead) {
      throw this.appError("ENGINE_NOT_READY", "项目目录访问被关闭", "Hermes 没有读取真实项目目录的权限。请开启读取项目目录，或改为纯聊天任务。", "open_settings");
    }
    if (["fix_error", "generate_web", "organize_files"].includes(input.taskType) && !permissions.fileWrite) {
      throw this.appError("ENGINE_NOT_READY", "文件写入权限被关闭", "当前任务通常需要创建或修改文件。请开启 Hermes 写入权限，或改为只读分析。", "open_settings");
    }
    if (input.taskType === "fix_error" && !permissions.commandRun) {
      throw this.appError("ENGINE_NOT_READY", "命令执行权限被关闭", "修复报错通常需要运行构建、测试或诊断命令。请开启 Hermes 命令权限，或改为只读分析。", "open_settings");
    }
    if (!permissions.memoryRead) {
      throw this.appError("ENGINE_NOT_READY", "记忆读取权限被关闭", "Hermes 需要读取 MEMORY.md 才能运行。请开启记忆读取权限。", "open_settings");
    }
  }

  private async assertWorkspace(workspacePath: string, required: boolean) {
    if (!workspacePath.trim()) {
      if (required) {
        throw this.appError("ENGINE_NOT_READY", "尚未选择项目目录", "请先选择一个真实项目目录，再执行项目分析、修复或文件整理任务。");
      }
      return;
    }
    const stat = await fs.stat(workspacePath).catch(() => undefined);
    if (!stat?.isDirectory()) {
      throw this.appError("ENGINE_NOT_READY", "工作区不可用", "请选择一个存在的本地文件夹。");
    }
    const probe = path.join(workspacePath, `.zhenghebao-preflight-${Date.now()}`);
    try {
      await fs.writeFile(probe, "ok", "utf8");
      await fs.unlink(probe);
    } catch (error) {
      throw this.appError("SNAPSHOT_FAILED", "工作区不可写", error instanceof Error ? error.message : "无法写入当前工作区。");
    }
  }

  private requiresWorkspace(input: StartTaskInput) {
    return Boolean(input.workspacePath?.trim()) && input.taskType !== "custom";
  }

  private async assertModel(modelProfileId?: string) {
    const config = await this.configStore.read();
    const profile = config.modelProfiles.find((item) => item.id === (modelProfileId ?? config.defaultModelProfileId)) ?? config.modelProfiles[0];
    if (!profile) {
      throw this.appError("MODEL_NOT_CONFIGURED", "缺少模型配置", "请先在设置里新增一个模型配置。", "configure_model");
    }
    if (profile.provider === "local" && profile.model === "mock-model") {
      throw this.appError("MODEL_NOT_CONFIGURED", "默认模型是占位配置", "当前默认模型是 mock-model，请在设置中配置并测试一个真实模型后再运行任务。", "configure_model");
    }
    if (profile.provider === "custom") {
      try {
        normalizeOpenAiCompatibleBaseUrl(profile.baseUrl);
      } catch {
        throw this.appError("MODEL_NOT_CONFIGURED", "本地模型地址无效", "请填写正确的 LM Studio Base URL，例如 http://127.0.0.1:1234/v1。", "configure_model");
      }
    }
    if (requiresStoredSecret(profile) && (!profile.secretRef || !(await this.secretVault.hasSecret(profile.secretRef)))) {
      throw this.appError("SECRET_MISSING", "缺少模型密钥", missingSecretMessage(profile), "configure_model");
    }
  }

  private async getCachedHealth() {
    if (this.healthCache && Date.now() - this.healthCache.checkedAt < 15_000) {
      return this.healthCache.health;
    }
    const health = await this.hermes.healthCheck();
    this.healthCache = { checkedAt: Date.now(), health };
    return health;
  }

  private appError(code: AppError["code"], title: string, message: string, fixAction?: AppError["fixAction"]) {
    const error = new Error(message) as Error & { appError: AppError };
    error.appError = { code, title, message, fixAction };
    return error;
  }
}
