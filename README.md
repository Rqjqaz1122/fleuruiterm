# FleurTerm

> FleurUI 打造的现代跨平台桌面终端。
>
> A modern cross-platform desktop terminal by FleurUI.

[![Release](https://img.shields.io/github/v/release/Rqjqaz1122/fleuruiterm?display_name=tag)](https://github.com/Rqjqaz1122/fleuruiterm/releases/latest)
[![Release FleurTerm](https://github.com/Rqjqaz1122/fleuruiterm/actions/workflows/release.yml/badge.svg)](https://github.com/Rqjqaz1122/fleuruiterm/actions/workflows/release.yml)

[中文](#中文) · [English](#english)

---

## 中文

### 项目简介

FleurTerm 是一个基于 `Tauri 2`、`Vue 3`、`TypeScript`、`xterm.js` 和 `Rust` 构建的桌面终端。它将 Local Shell、SSH、Terminal workspace、SFTP 文件传输和 AI-assisted terminal workflow 集成在同一个轻量级原生应用中。

当前稳定版本为 [v0.0.7](https://github.com/Rqjqaz1122/fleuruiterm/releases/tag/v0.0.7)，提供 macOS Universal 和 Windows x64 安装包。

### 功能特性

- **Terminal workspace**：支持多个 Terminal tabs、水平/垂直 split、拖拽排序、动态 resize 和有界 scrollback。
- **本地与远程连接**：支持 Local Shell、SSH 和依赖系统客户端的 Telnet；可保存连接配置、认证方式、端口转发、启动命令和工作目录。
- **Workspace persistence**：自动保存 Terminal tabs、连接来源、排列顺序和当前活动页，并在应用重新启动后恢复。
- **SFTP**：SSH Terminal 可打开可调整高度的 SFTP drawer，支持目录浏览、刷新、上传、下载以及 Host Key 校验。
- **AI Assistant**：支持 OpenAI、Anthropic、Local OpenAI-compatible endpoint 和 Custom provider，可选 Terminal context、streaming response、Markdown 渲染、tool call 和分级 command policy。
- **个性化设置**：支持简体中文/English、主题模式、Terminal 字体、字号、行高、scrollback、cursor blink 和自定义快捷键。
- **安全凭据**：保存的连接密码通过本地加密 credential vault 管理，不会写入普通连接配置。
- **自动更新**：正式安装包通过 Tauri Updater 检查 GitHub Releases，并校验签名后的 updater artifacts。
- **跨平台窗口体验**：针对 macOS 和 Windows 提供原生窗口控制及平滑缩放适配。

> 当前限制：Serial connection 的配置界面已存在，但 Terminal backend 尚未实现 Serial session；SFTP 仅适用于已保存的 SSH connection。

### 技术栈

| 层级            | 技术                                |
| --------------- | ----------------------------------- |
| Desktop runtime | Tauri 2                             |
| Frontend        | Vue 3, TypeScript, Pinia, Vite      |
| Terminal        | xterm.js, `xterm-addon-fit`         |
| Native backend  | Rust, Tokio, `portable-pty`, `ssh2` |
| Testing         | Vitest, Vue Test Utils, Rust Test   |
| Tooling         | pnpm, ESLint, Prettier, Clippy      |

### 下载与安装

前往 [Latest Release](https://github.com/Rqjqaz1122/fleuruiterm/releases/latest) 下载适合当前平台的安装包：

- **macOS**：`FleurTerm_*_universal.dmg`，同时支持 Apple Silicon 和 Intel。
- **Windows x64**：`FleurTerm_*_x64-setup.exe` 或 `FleurTerm_*_x64_en-US.msi`。

当前 Release workflow 不发布 Linux 安装包。

### 本地开发

#### 环境要求

- Node.js `>= 22.12`（项目提供 `.nvmrc`）
- pnpm `11.9.0`
- Rust stable `>= 1.85`
- 对应操作系统的 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

#### 安装依赖并启动

```bash
git clone https://github.com/Rqjqaz1122/fleuruiterm.git
cd fleuruiterm
nvm use
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` 会同时启动 Vite frontend 和 Tauri desktop runtime。仅需预览 Web UI 时可以运行：

```bash
pnpm dev
```

浏览器预览无法创建 Terminal session，因为 PTY、SFTP、settings persistence 和 updater commands 均由 Rust backend 通过 Tauri IPC 提供。

### 验证

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm version:check

cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

### 构建桌面安装包

```bash
pnpm tauri build
```

构建产物位于 `src-tauri/target/release/bundle`。不同平台需要在对应操作系统或 CI runner 上分别构建。

### 项目架构

```text
src/
├── components/   Vue UI、Terminal workspace、Settings、AI 和 SFTP
├── domain/       Tab、Session、Split tree 等领域模型
├── services/     Tauri IPC client、AI client、Updater 和 persistence
├── stores/       Workspace、Settings、AI conversation 和 Update 状态
└── terminal/     xterm.js lifecycle、theme 和 output adapter

src-tauri/src/
├── ipc/          参数校验、Tauri commands 和稳定的 public errors
├── session/      PTY backend、Session registry 和 lifecycle
├── sftp/         SSH/SFTP connection、路径和文件传输
└── lib.rs        应用初始化、plugin 注册和窗口生命周期
```

WebView 不直接启动系统进程。Terminal 输入、resize、interrupt、close、PTY cleanup 和 SFTP 操作均通过 typed Tauri IPC 进入 Rust backend。

### Release 与安全

- 版本号由 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 共同维护。
- 推送 `v*` Tag 会触发 GitHub Actions，构建 macOS Universal、Windows x64 和 `latest.json`。
- updater private key、certificate、Token 和其他 Secrets 不得提交到仓库。
- 完整发布说明参见 [docs/releasing.md](docs/releasing.md)。

---

## English

### Overview

FleurTerm is a desktop terminal built with `Tauri 2`, `Vue 3`, `TypeScript`, `xterm.js`, and `Rust`. It brings Local Shell, SSH, a Terminal workspace, SFTP file transfers, and AI-assisted terminal workflows together in one lightweight native application.

The current stable version is [v0.0.7](https://github.com/Rqjqaz1122/fleuruiterm/releases/tag/v0.0.7), with macOS Universal and Windows x64 installers.

### Features

- **Terminal workspace**: Multiple Terminal tabs, horizontal and vertical splits, drag reordering, dynamic resize handling, and bounded scrollback.
- **Local and remote connections**: Local Shell, SSH, and Telnet through the system client, with saved profiles for authentication, port forwarding, startup commands, and working directories.
- **Workspace persistence**: Restores Terminal tabs, launch sources, tab order, and the active tab after restarting the application.
- **SFTP**: SSH Terminals can open a resizable SFTP drawer with directory navigation, refresh, upload, download, and Host Key validation.
- **AI Assistant**: OpenAI, Anthropic, Local OpenAI-compatible endpoints, and Custom providers with optional Terminal context, streaming responses, Markdown rendering, tool calls, and tiered command policies.
- **Personalization**: Simplified Chinese/English UI, theme modes, Terminal fonts, font size, line height, scrollback, cursor blink, and customizable shortcuts.
- **Secure credentials**: Saved connection passwords are managed by a local encrypted credential vault instead of being written to plain connection settings.
- **Automatic updates**: Production builds use Tauri Updater to check GitHub Releases and verify signed updater artifacts.
- **Cross-platform windows**: Native window controls and smooth resize behavior for macOS and Windows.

> Current limitations: the Serial connection form is available, but the Terminal backend does not yet implement Serial sessions. SFTP is available only for saved SSH connections.

### Technology Stack

| Layer           | Technologies                        |
| --------------- | ----------------------------------- |
| Desktop runtime | Tauri 2                             |
| Frontend        | Vue 3, TypeScript, Pinia, Vite      |
| Terminal        | xterm.js, `xterm-addon-fit`         |
| Native backend  | Rust, Tokio, `portable-pty`, `ssh2` |
| Testing         | Vitest, Vue Test Utils, Rust Test   |
| Tooling         | pnpm, ESLint, Prettier, Clippy      |

### Download and Install

Open the [Latest Release](https://github.com/Rqjqaz1122/fleuruiterm/releases/latest) and download the installer for your platform:

- **macOS**: `FleurTerm_*_universal.dmg` for both Apple Silicon and Intel.
- **Windows x64**: `FleurTerm_*_x64-setup.exe` or `FleurTerm_*_x64_en-US.msi`.

The current Release workflow does not publish Linux installers.

### Local Development

#### Prerequisites

- Node.js `>= 22.12` (the repository includes `.nvmrc`)
- pnpm `11.9.0`
- Rust stable `>= 1.85`
- Platform-specific [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

#### Install and Run

```bash
git clone https://github.com/Rqjqaz1122/fleuruiterm.git
cd fleuruiterm
nvm use
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts both the Vite frontend and the Tauri desktop runtime. To preview only the Web UI, run:

```bash
pnpm dev
```

The browser preview cannot create Terminal sessions because PTY, SFTP, settings persistence, and updater commands are provided by the Rust backend through Tauri IPC.

### Verification

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm version:check

cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

### Build Desktop Installers

```bash
pnpm tauri build
```

Build artifacts are written to `src-tauri/target/release/bundle`. Each platform must be built on its matching operating system or CI runner.

### Architecture

```text
src/
├── components/   Vue UI, Terminal workspace, Settings, AI, and SFTP
├── domain/       Domain models for tabs, sessions, and split trees
├── services/     Tauri IPC clients, AI client, updater, and persistence
├── stores/       Workspace, Settings, AI conversation, and Update state
└── terminal/     xterm.js lifecycle, theme, and output adapter

src-tauri/src/
├── ipc/          Input validation, Tauri commands, and stable public errors
├── session/      PTY backend, Session registry, and lifecycle
├── sftp/         SSH/SFTP connections, paths, and file transfers
└── lib.rs        Application setup, plugin registration, and window lifecycle
```

The WebView never spawns system processes directly. Terminal input, resize, interrupt, close, PTY cleanup, and SFTP operations cross typed Tauri IPC boundaries into the Rust backend.

### Release and Security

- The version is kept in sync across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Pushing a `v*` Tag triggers GitHub Actions to build macOS Universal, Windows x64, and `latest.json`.
- Updater private keys, certificates, Tokens, and other Secrets must never be committed.
- See [docs/releasing.md](docs/releasing.md) for the complete release process.
