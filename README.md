# Hermes Forge

[![Release](https://img.shields.io/github/v/release/Mahiruxia/hermes-forge)](https://github.com/Mahiruxia/hermes-forge/releases)
[![License](https://img.shields.io/github/license/Mahiruxia/hermes-forge)](LICENSE)

A local-first desktop client for [Hermes Agent](https://github.com/NousResearch/hermes-agent), built with Electron + React + TypeScript.

> Hermes Forge is a community project, not an official Hermes Agent client.

![Dashboard](assets/screenshots/hermes-forge-dashboard.png)

## Overview

Hermes Forge provides a unified desktop interface for Hermes Agent on Windows and macOS. It handles installation, model configuration, task execution, file attachments, permission gating, and auto-updates — without requiring manual CLI setup.

Key capabilities:

- **Zero-config onboarding** — Auto-detects missing dependencies (Git, Python, Hermes Agent) and offers one-click repair or installation.
- **Model sync** — Desktop model profiles sync to Hermes CLI and Gateway runtime, preventing config drift across interfaces.
- **Native Windows bridge** — File operations, PowerShell, clipboard, screenshots, window management, and keyboard/mouse automation with main-process approval gating.
- **Kanban task board** — Full task lifecycle management with Gateway scheduler integration, drag-and-drop, and real-time diagnostics.
- **WeChat Gateway** — QR-code login with state-machine-driven onboarding and dependency recovery.
- **Auto-update** — `electron-updater` backed by GitHub Releases with silent background checks and progress tracking.

## Download

| Platform | Download |
|----------|----------|
| Windows (x64) | [`Hermes-Forge-x.y.z-x64.exe`](https://github.com/Mahiruxia/hermes-forge/releases) |
| macOS (Apple Silicon) | [`Hermes-Forge-x.y.z-arm64.dmg`](https://github.com/Mahiruxia/hermes-forge/releases) |

> Unsigned binaries. Gatekeeper / SmartScreen warnings on first launch are expected.

## Development

Requirements: Node.js 20+, npm, Git, Python 3.10+

```bash
git clone https://github.com/Mahiruxia/hermes-forge.git
cd hermes-forge
npm install
cp .env.example .env
npm run dev
```

```bash
npm run check    # TypeScript
npm test         # Vitest
npm run build    # Production
```

## Runtime Resolution

Hermes root path resolves in order:

1. Application setting
2. `HERMES_HOME`
3. `HERMES_AGENT_HOME`
4. `~/Hermes Agent`
5. `<project-root>/Hermes Agent`

Override at build time:

```dotenv
HERMES_INSTALL_REPO_URL=https://github.com/NousResearch/hermes-agent.git
```

## Architecture

```
src/
  main/       Electron main process, IPC, config, secrets, connectors
  preload/    Secure renderer bridge
  renderer/   React UI, workbench, settings, connectors
  adapters/   Hermes CLI adapter, output parsing, launch metadata
  process/    Task runner, command runner, snapshots, workspace locks
  setup/      First-run diagnostics, auto-install, dependency repair
  updater/    GitHub Releases auto-update
  security/   Path validation, permission constants
  shared/     Types, schemas, IPC channels
```

Design principles:

- **Hermes-only** — Single execution engine. No multi-engine branching.
- **Main-process trust boundary** — Credentials, filesystem, subprocesses, and native capabilities live in the main process.
- **Whitelist IPC** — Renderer access is restricted to explicit preload APIs.
- **Recoverable first-run** — Missing dependencies are surfaced with actionable fixes, not stack traces.
- **Local-first** — Sessions, attachments, snapshots, and logs stay on the user's machine.

## Capabilities & Roadmap

- [Capability Matrix](CAPABILITY_MATRIX.md)
- [Roadmap](ROADMAP.md)

## Contributing

Issues, discussions, and draft PRs are welcome. Priority areas:

- First-run and dependency repair UX
- Windows physical-machine compatibility
- WeChat Gateway long-running stability
- Non-WeChat connector runtime adapters
- Windows bridge approval UX and audit trails
- Electron E2E / smoke tests
- Code signing and release provenance

```bash
npm run check && npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT
