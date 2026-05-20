import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorsPanel } from "./ConnectorsPanel";
import type { HermesConnectorField, HermesConnectorListResult, WeixinQrLoginStatus } from "../../../../shared/types";

const listConnectors = vi.fn<() => Promise<HermesConnectorListResult>>();
const getWeixinQrLoginStatus = vi.fn<() => Promise<WeixinQrLoginStatus>>();
const startWeixinQrLogin = vi.fn<() => Promise<{ ok: boolean; status: WeixinQrLoginStatus; message: string }>>();
const cancelWeixinQrLogin = vi.fn<() => Promise<{ ok: boolean; status: WeixinQrLoginStatus; message: string }>>();
const installWeixinDependency = vi.fn<() => Promise<{ ok: boolean; message: string; command: string; stdout: string; stderr: string; status?: WeixinQrLoginStatus }>>();
const syncConnectorsEnv = vi.fn();
const saveConnector = vi.fn();
const disableConnector = vi.fn();
const startGateway = vi.fn();
const stopGateway = vi.fn();
const restartGateway = vi.fn();
const scrollIntoView = vi.fn();

beforeEach(() => {
  listConnectors.mockReset();
  getWeixinQrLoginStatus.mockReset();
  startWeixinQrLogin.mockReset();
  cancelWeixinQrLogin.mockReset();
  installWeixinDependency.mockReset();
  syncConnectorsEnv.mockReset();
  saveConnector.mockReset();
  disableConnector.mockReset();
  startGateway.mockReset();
  stopGateway.mockReset();
  restartGateway.mockReset();
  scrollIntoView.mockReset();
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  Object.assign(window, {
    workbenchClient: {
      listConnectors,
      getWeixinQrLoginStatus,
      startWeixinQrLogin,
      cancelWeixinQrLogin,
      installWeixinDependency,
      syncConnectorsEnv,
      saveConnector,
      disableConnector,
      startGateway,
      stopGateway,
      restartGateway,
    },
  });
});

describe("ConnectorsPanel", () => {
  it("uses quick setup mode for non-Weixin connectors and autofills common email providers", async () => {
    listConnectors.mockResolvedValue(buildListResult({
      connectors: [
        buildConnector({
          platformId: "email",
          label: "Email",
          status: "unconfigured",
          runtimeStatus: "stopped",
          configured: false,
          message: "等待邮箱接入。",
          fields: [
            { key: "address", envVar: "EMAIL_ADDRESS", label: "邮箱地址", type: "text", required: true, placeholder: "hermes@example.com" },
            { key: "password", envVar: "EMAIL_PASSWORD", label: "邮箱密码/App Password", type: "password", required: true, secret: true, placeholder: "app password" },
            { key: "imapHost", envVar: "EMAIL_IMAP_HOST", label: "IMAP Host", type: "text", required: true, placeholder: "imap.gmail.com" },
            { key: "smtpHost", envVar: "EMAIL_SMTP_HOST", label: "SMTP Host", type: "text", required: true, placeholder: "smtp.gmail.com" },
            { key: "allowedUsers", envVar: "EMAIL_ALLOWED_USERS", label: "允许发件人", type: "text" },
            { key: "homeAddress", envVar: "EMAIL_HOME_ADDRESS", label: "Home Address", type: "text" },
          ],
        }),
      ],
    }));

    render(<ConnectorsPanel />);

    expect(await screen.findByText("Email")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "快速配置" }));

    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText("邮箱接入优先只填邮箱和密码，常见服务商的 IMAP/SMTP 会自动补齐。")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("hermes@example.com"), { target: { value: "bot@gmail.com" } });
    expect(screen.getByText("已自动识别：Gmail 服务器地址已自动填入")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示高级项" }));
    expect(screen.getByDisplayValue("imap.gmail.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("smtp.gmail.com")).toBeInTheDocument();
  });

  it("shows an explicit idle prompt before Weixin QR login starts", async () => {
    listConnectors.mockResolvedValue(buildListResult({
      connectors: [
        buildConnector({
          platformId: "weixin",
          label: "微信",
          status: "unconfigured",
          runtimeStatus: "stopped",
          configured: false,
          message: "等待扫码接入。",
        }),
      ],
    }));
    getWeixinQrLoginStatus.mockResolvedValue({
      running: false,
      phase: "idle",
      message: "请点击开始扫码获取微信二维码。",
    });

    render(<ConnectorsPanel />);

    expect(await screen.findByText("微信")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "扫码接入" })[0]);

    expect(await screen.findByText("请点击开始扫码")).toBeInTheDocument();
    expect(screen.getByText("二维码不会自动生成，点击右侧按钮后才会拉起本次微信扫码流程。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始扫码" })).toBeInTheDocument();
  });

  it("keeps QQ Bot in quick-setup mode when no connector values are configured", async () => {
    listConnectors.mockResolvedValue(buildListResult({
      connectors: [
        buildConnector({
          platformId: "qqbot",
          label: "QQ Bot",
          status: "unconfigured",
          runtimeStatus: "stopped",
          configured: false,
          message: "尚未配置，点击快速配置开始接入。",
        }),
      ],
    }));

    render(<ConnectorsPanel />);

    expect(await screen.findByText("QQ Bot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "快速配置" })).toBeInTheDocument();
    expect(screen.getByText("尚未配置，点击快速配置开始接入。")).toBeInTheDocument();
    expect(screen.queryByText("已配置")).not.toBeInTheDocument();
  });

  it("renders connector config status separately from runtime status", async () => {
    listConnectors.mockResolvedValue(buildListResult({
      connectors: [
        buildConnector({
          platformId: "weixin",
          label: "微信",
          status: "configured",
          runtimeStatus: "error",
          configured: true,
          message: "Gateway 崩溃，需要重启。",
        }),
      ],
      gateway: {
        running: false,
        managedRunning: false,
        healthStatus: "error",
        message: "Gateway exited with code 1.",
        checkedAt: "2026-04-21T01:00:00.000Z",
        lastExitCode: 1,
        restartCount: 2,
      },
    }));

    render(<ConnectorsPanel />);

    expect(await screen.findByText("微信")).toBeInTheDocument();
    expect(screen.getByText("已配置")).toBeInTheDocument();
    expect(screen.getByText("运行异常")).toBeInTheDocument();
    expect(screen.getByText("异常")).toBeInTheDocument();
  });

  it("lets a stopped Feishu instance start even when another Gateway is already running", async () => {
    const runningAlphaStoppedBeta = buildListResult({
      connectors: [
        buildConnector({
          platformId: "feishu",
          label: "Feishu",
          status: "configured",
          runtimeStatus: "stopped",
          configured: true,
          message: "已配置，等待同步或启动 Gateway。",
          instanceId: "beta",
          agentId: "agent-beta",
        }),
      ],
      gateway: {
        running: true,
        managedRunning: true,
        healthStatus: "running",
        platformStates: { "feishu:alpha": "connected" },
        connectedPlatforms: ["feishu:alpha"],
        message: "Gateway 正由桌面端托管运行。",
        checkedAt: "2026-05-20T01:00:00.000Z",
      },
    });
    listConnectors.mockResolvedValue(runningAlphaStoppedBeta);
    startGateway.mockResolvedValue({
      ok: true,
      message: "Gateway 已启动。",
      status: runningAlphaStoppedBeta.gateway,
    });

    render(<ConnectorsPanel />);

    expect(await screen.findByText("Feishu")).toBeInTheDocument();
    expect(screen.getByText("Feishu:beta")).toBeInTheDocument();
    expect(screen.getByText("Agent:agent-beta")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "启动 Gateway" }));
    expect(await screen.findByText("Gateway 已启动。")).toBeInTheDocument();
    expect(startGateway).toHaveBeenCalledTimes(1);
  });

  it("keeps saved Feishu advanced fields visible when editing", async () => {
    listConnectors.mockResolvedValue(buildListResult({
      connectors: [
        buildConnector({
          platformId: "feishu",
          label: "Feishu",
          status: "configured",
          runtimeStatus: "running",
          configured: true,
          message: "已配置，Gateway 正在运行。",
          instanceId: "alpha",
          agentId: "agent-alpha",
          fields: [
            { key: "appId", envVar: "FEISHU_APP_ID", label: "App ID", type: "text", required: true },
            { key: "appSecret", envVar: "FEISHU_APP_SECRET", label: "App Secret", type: "password", required: true, secret: true },
            { key: "domain", envVar: "FEISHU_DOMAIN", label: "Domain", type: "text" },
            { key: "connectionMode", envVar: "FEISHU_CONNECTION_MODE", label: "连接模式", type: "text" },
            { key: "agentId", envVar: "HERMES_AGENT_ID", label: "绑定 Agent", type: "text" },
            { key: "allowBots", envVar: "FEISHU_ALLOW_BOTS", label: "允许机器人消息", type: "text" },
            { key: "botOpenId", envVar: "FEISHU_BOT_OPEN_ID", label: "Bot Open ID", type: "text" },
            { key: "encryptKey", envVar: "FEISHU_ENCRYPT_KEY", label: "Webhook Encrypt Key", type: "password", secret: true },
          ],
          values: {
            appId: "cli_saved",
            domain: "feishu",
            connectionMode: "websocket",
            agentId: "agent-alpha",
            allowBots: "mentions",
            botOpenId: "ou_saved",
          },
          secretStatus: { appSecret: true, encryptKey: true },
        }),
      ],
    }));

    render(<ConnectorsPanel />);

    expect(await screen.findByText("Feishu")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[1]);

    expect(screen.getByDisplayValue("cli_saved")).toBeInTheDocument();
    expect(screen.getByDisplayValue("agent-alpha")).toBeInTheDocument();
    expect(screen.getByDisplayValue("mentions")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ou_saved")).toBeInTheDocument();
    expect(screen.getAllByText("已保存密钥，留空保存不会覆盖。")).toHaveLength(2);
  });

  it("shows timeout state in the Weixin QR wizard", async () => {
    listConnectors.mockResolvedValue(buildListResult({
      connectors: [
        buildConnector({
          platformId: "weixin",
          label: "微信",
          status: "unconfigured",
          runtimeStatus: "stopped",
          configured: false,
          message: "等待扫码接入。",
        }),
      ],
    }));
    getWeixinQrLoginStatus.mockResolvedValue({
      running: false,
      phase: "idle",
      message: "请点击开始扫码获取微信二维码。",
    });
    startWeixinQrLogin.mockResolvedValue({
      ok: false,
      message: "二维码已超时，请重新扫码。",
      status: {
        running: false,
        phase: "timeout",
        message: "二维码已超时，请重新扫码。",
        failureCode: "qr_timeout",
        attempt: 2,
      },
    });

    render(<ConnectorsPanel />);

    expect(await screen.findByText("微信")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "扫码接入" })[0]);

    expect((await screen.findAllByText("扫码超时")).length).toBeGreaterThan(0);
    expect(screen.getByText("错误码：qr_timeout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新扫码" })).toBeInTheDocument();
  });

  it("shows one-click dependency repair when aiohttp is missing", async () => {
    listConnectors.mockResolvedValue(buildListResult({
      connectors: [
        buildConnector({
          platformId: "weixin",
          label: "微信",
          status: "unconfigured",
          runtimeStatus: "stopped",
          configured: false,
          message: "等待扫码接入。",
        }),
      ],
    }));
    startWeixinQrLogin.mockResolvedValue({
      ok: false,
      message: "缺少 aiohttp，微信扫码运行环境不完整。",
      status: {
        running: false,
        phase: "failed",
        message: "缺少 aiohttp，微信扫码运行环境不完整。",
        failureCode: "missing_aiohttp",
        recoveryAction: "install_aiohttp",
        recoveryCommand: "py -3 -m pip install aiohttp",
        runtimePythonLabel: "py -3",
        failureKind: "recoverable",
      },
    });
    getWeixinQrLoginStatus.mockResolvedValue({
      running: false,
      phase: "idle",
      message: "请点击开始扫码获取微信二维码。",
    });

    render(<ConnectorsPanel />);
    expect(await screen.findByText("微信")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "扫码接入" })[0]);

    expect(await screen.findByRole("button", { name: "一键安装依赖" })).toBeInTheDocument();
    expect(screen.getByText("缺少 `aiohttp`，微信扫码运行环境不完整。")).toBeInTheDocument();
    expect(screen.getByText("py -3 -m pip install aiohttp")).toBeInTheDocument();
  });
});

function buildListResult(overrides: Partial<HermesConnectorListResult> = {}): HermesConnectorListResult {
  return {
    connectors: [],
    gateway: {
      running: false,
      managedRunning: false,
      healthStatus: "stopped",
      message: "Gateway stopped.",
      checkedAt: "2026-04-21T01:00:00.000Z",
    },
    envPath: "D:/workspace/.env",
    ...overrides,
  };
}

function buildConnector(overrides: {
  platformId: "weixin" | "telegram" | "email" | "feishu" | "qqbot";
  label: string;
  status: "unconfigured" | "configured" | "running" | "error" | "disabled";
  runtimeStatus: "stopped" | "running" | "error";
  configured: boolean;
  message: string;
  fields?: HermesConnectorField[];
  instanceId?: string;
  agentId?: string;
  values?: Record<string, string | boolean>;
  secretRefs?: Record<string, string>;
  secretStatus?: Record<string, boolean>;
}) {
  return {
    platform: {
      id: overrides.platformId,
      label: overrides.label,
      category: "official" as const,
      description: `${overrides.label} connector`,
      fields: overrides.fields ?? [],
      setupHelp: [],
    },
    instanceId: overrides.instanceId,
    agentId: overrides.agentId,
    instanceLabel: overrides.instanceId ? overrides.label : undefined,
    status: overrides.status,
    runtimeStatus: overrides.runtimeStatus,
    enabled: true,
    configured: overrides.configured,
    missingRequired: [],
    values: overrides.values ?? {},
    secretRefs: overrides.secretRefs ?? {},
    secretStatus: overrides.secretStatus ?? {},
    message: overrides.message,
  };
}
