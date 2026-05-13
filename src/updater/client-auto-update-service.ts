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
      const message = error instanceof Error ? error.message : "检查更新失败。";
      this.publish(this.event("error", `客户端更新检查失败：${message}`, { manual }));
      return this.lastEvent;
    } finally {
      this.checking = false;
    }
  }

  snapshot() {
    return this.lastEvent;
  }

  downloadUpdate() {
    if (!this.pendingUpdateInfo) return;
    void autoUpdater.downloadUpdate();
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
      const message = error instanceof Error ? error.message : String(error);
      this.publish(this.event("error", `自动更新失败：${message}`));
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
