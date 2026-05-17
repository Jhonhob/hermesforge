import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo } from "electron-updater";
import { IpcChannels } from "../shared/ipc";
import type { ClientUpdateEvent } from "../shared/types";

export class ClientAutoUpdateService {
  private lastEvent: ClientUpdateEvent;
  private checking = false;
  private startupCheckScheduled = false;
  private pendingUpdateInfo: UpdateInfo | null = null;
  private skippedVersion: string | null = null;

  constructor(private readonly getMainWindow: () => BrowserWindow | undefined) {
    this.lastEvent = this.event("idle", "自动更新已就绪。");
    this.configure();
  }

  scheduleStartupCheck(delayMs = 5000) {
    if (this.startupCheckScheduled) return;
    this.startupCheckScheduled = true;
    setTimeout(() => {
      void this.checkForUpdates(false);
    }, delayMs);
  }

  async checkForUpdates(manual = true): Promise<ClientUpdateEvent> {
    if (this.checking) {
      return this.lastEvent;
    }
    this.checking = true;
    try {
      this.publish(this.event("checking", manual ? "正在手动检查客户端更新..." : "正在后台检查客户端更新...", { manual }));
      const timedOut = Symbol("update-check-timeout");
      const result = await Promise.race([
        autoUpdater.checkForUpdates().then(() => undefined),
        delay(35_000).then(() => timedOut),
      ]);
      if (result === timedOut) {
        this.publish(this.event("idle", manual ? "检查更新超时，可稍后手动重试。" : "启动时更新检查未完成，已停止等待。", { manual }));
      }
      return this.lastEvent;
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = sanitizeUpdateError(raw);
      this.publish(this.event("error", `客户端更新检查失败：${message}`, { manual, detail: raw }));
      return this.lastEvent;
    } finally {
      this.checking = false;
    }
  }

  snapshot() {
    return this.lastEvent;
  }

  async downloadUpdate(): Promise<ClientUpdateEvent> {
    if (!this.pendingUpdateInfo) {
      return this.event("error", "没有待下载的更新。");
    }
    try {
      await autoUpdater.downloadUpdate();
      return this.lastEvent;
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = sanitizeUpdateError(raw);
      this.publish(this.event("error", `下载更新失败：${message}`, { detail: raw }));
      return this.lastEvent;
    }
  }

  installUpdate() {
    autoUpdater.quitAndInstall(false, true);
  }

  skipVersion(version: string) {
    this.skippedVersion = version;
    this.publish(this.event("skipped", `已跳过版本 ${version}。`, { latestVersion: version }));
  }

  private configure() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      this.publish(this.event("checking", "正在检查客户端更新..."));
    });

    autoUpdater.on("update-available", (info) => {
      this.pendingUpdateInfo = info;
      if (this.skippedVersion === info.version) {
        this.publish(this.event("skipped", `版本 ${info.version} 已跳过。`, {
          latestVersion: info.version,
          releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
        }));
        return;
      }
      this.publish(this.event("available", `发现新版本 ${info.version}。`, {
        latestVersion: info.version,
        releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
      }));
    });

    autoUpdater.on("update-not-available", (info) => {
      this.pendingUpdateInfo = null;
      this.publish(this.event("not-available", "当前已经是最新版本。", {
        latestVersion: info.version,
      }));
    });

    autoUpdater.on("download-progress", (progress) => {
      this.publish(this.event("downloading", `正在下载更新：${Math.round(progress.percent)}%`, {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      }));
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.publish(this.event("downloaded", `新版本 ${info.version} 已准备就绪。`, {
        latestVersion: info.version,
        releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
        percent: 100,
      }));
    });

    autoUpdater.on("error", (error) => {
      const raw = error instanceof Error ? error.message : String(error);
      const message = sanitizeUpdateError(raw);
      this.publish(this.event("error", `自动更新失败：${message}`, { detail: raw }));
    });
  }

  private event(
    status: ClientUpdateEvent["status"],
    message: string,
    patch: Partial<ClientUpdateEvent> = {},
  ): ClientUpdateEvent {
    return {
      status,
      message,
      currentVersion: app.getVersion(),
      at: new Date().toISOString(),
      ...patch,
    };
  }

  private publish(event: ClientUpdateEvent) {
    this.lastEvent = event;
    const window = this.getMainWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(IpcChannels.clientUpdateEvent, event);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 清理 electron-updater 的原始错误，提取用户友好的信息 */
function sanitizeUpdateError(raw: string): string {
  if (!raw) return "请检查网络连接或稍后重试。";

  // GitHub 404 — release 或文件不存在
  if (raw.includes("404") || raw.includes("Not Found")) {
    return "服务器上没有找到该版本的安装包，可能已被删除或尚未上传。";
  }

  // 网络超时
  if (raw.includes("ETIMEDOUT") || raw.includes("timeout") || raw.includes("TIMEOUT")) {
    return "连接更新服务器超时，请检查网络或稍后重试。";
  }

  // 网络不可达
  if (raw.includes("ECONNREFUSED") || raw.includes("ENOTFOUND") || raw.includes("getaddrinfo")) {
    return "无法连接到更新服务器，请检查网络或代理设置。";
  }

  // SSL/TLS 证书错误
  if (raw.includes("certificate") || raw.includes("SSL") || raw.includes("TLS")) {
    return "网络证书验证失败，请检查系统时间是否正确，或尝试更换网络。";
  }

  // SHA checksum 不匹配
  if (raw.includes("sha") || raw.includes("checksum") || raw.includes("hash")) {
    return "安装包校验失败，可能下载不完整，请重新下载。";
  }

  // 磁盘/权限问题
  if (raw.includes("EACCES") || raw.includes("permission") || raw.includes("EPERM")) {
    return "文件写入权限不足，请以管理员身份运行应用。";
  }

  if (raw.includes("ENOSPC") || raw.includes("no space")) {
    return "磁盘空间不足，请清理后再试。";
  }

  // 通用网络错误
  if (raw.includes("network") || raw.includes("ECONNRESET") || raw.includes("EPIPE")) {
    return "网络连接异常，请检查网络或稍后重试。";
  }

  // 删除过长的原始错误栈，保留核心信息
  const short = raw.split("\n")[0].slice(0, 120);
  return short.length > 60 ? `${short}...` : short;
}
