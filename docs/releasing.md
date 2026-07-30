# FleurTerm 发布与自动更新

FleurTerm 使用公开 GitHub Releases 和 Tauri Updater 发布 macOS、Windows 安装包。客户端从以下地址检查正式发布的最新版本：

```text
https://github.com/Rqjqaz1122/fleuruiterm/releases/latest/download/latest.json
```

## 首次配置

1. 将 `Rqjqaz1122/fleuruiterm` 设置为公开仓库。
2. 使用 Tauri CLI 在安全位置生成更新签名密钥。私钥不得写入此仓库。
3. 确认 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 与当前私钥配对。公钥可以提交，私钥不得提交。
4. 在 GitHub 仓库的 Actions Secrets 中创建：
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
5. 配置 macOS Apple Developer 签名与公证 Secrets：
   - `APPLE_CERTIFICATE`
   - `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_SIGNING_IDENTITY`
   - `APPLE_ID`
   - `APPLE_PASSWORD`
   - `APPLE_TEAM_ID`

更新签名密钥只验证更新包来源，不能替代 Apple 代码签名与公证。缺少 Apple 签名材料时，不得将 macOS 产物作为正式自动更新发布。

## 分支约束

- 新增功能或修复 Bug 前，必须先从最新的 `main` 创建独立分支，不得直接在 `main` 开发。
- 功能分支使用清晰的 English 名称，例如 `codex/feature-session-search`。
- Bug 修复分支使用清晰的 English 名称，例如 `codex/fix-terminal-reconnect-focus`。
- 分支必须通过测试和代码检查后才能合并回 `main`。
- 仅文档或发布元数据修改可以在维护者明确要求时直接提交到 `main`。

## Commit 约束

Commit subject 和正文必须使用 English。正文必须使用从 `1.` 开始的编号列表，逐条说明修改位置、新增功能、行为变化或修复的具体 Bug，不得只写 `update`、`fix issue`、`prepare release` 等模糊内容。

推荐格式：

```text
fix: restore terminal focus after reconnection

1. Focus the newly mounted xterm instance after an SSH session reconnects.
2. Add regression coverage for terminal mount and pane activation focus behavior.
```

即使 Commit 只包含一项修改，正文也必须保留 `1.` 编号。多项修改必须拆成多条，禁止把互不相关的内容合并成一句。

## Tag 与 Release notes 约束

- 从 `v0.0.8` 开始只允许创建 annotated tag，tag 标题和正文必须使用 English。
- Tag 正文必须使用编号列表，准确说明该版本新增了什么、修改了什么以及修复了什么问题。
- Tag 正文会被 release workflow 直接用作公开的 GitHub Release notes，因此不得包含内部信息、凭据或未经确认的功能。
- 禁止使用 `See the assets below to install or update FleurTerm.` 或其他没有说明实际改动的通用文案。
- 不得创建只有版本号、没有编号正文的 tag。

推荐格式：

```text
FleurTerm v0.0.8

1. Added automatic terminal focus restoration after SSH reconnection.
2. Fixed selectable labels and glyphs inside application action buttons.
3. Updated the start page to use the terminal-oriented visual design.
```

创建 tag 时可以使用多个 `-m` 参数保留标题和编号正文：

```bash
git tag -a v0.0.8 \
  -m "FleurTerm v0.0.8" \
  -m "1. Added automatic terminal focus restoration after SSH reconnection.
2. Fixed selectable labels and glyphs inside application action buttons."
```

## 发布新版本

1. 确认所有功能和 Bug 修复都已通过独立分支合并到 `main`。
2. 同步修改以下版本号：
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`
   - `src-tauri/tauri.conf.json`
3. 运行前端测试、Rust 测试、lint、typecheck、production build 和 `pnpm version:check`。
4. 按 Commit 约束提交版本修改，Commit 正文必须逐条说明本次发布内容。
5. 创建与应用版本匹配的 annotated tag，例如版本 `0.2.0` 对应 `v0.2.0`，并按 Tag 约束填写 English numbered release notes。
6. 推送 `main` 和 Tag。GitHub Actions 将构建 macOS Universal、Windows x64、更新签名、`latest.json`，并使用 tag 正文创建正式 Release。
7. 检查两个平台的安装包、签名文件、`latest.json` 和公开 Release notes，确认内容与 tag 正文一致。

## 本地开发

本地开发和普通调试构建默认不启用联网更新检查。发布工作流设置 `VITE_UPDATER_ENABLED=true`，正式安装包才会在启动时静默检查更新。浏览器预览会显示“不支持更新”，不会调用 Tauri 插件。

## 安全要求

- 不得提交私钥、证书、Token、Apple 密码或 GitHub Secrets。
- 不得在日志中打印上述内容。
- 不得发布 `latest.json` 与安装包签名不匹配的 Release。
- Tag 正文不得泄露主机、账号、凭据、内部地址或其他敏感信息。
