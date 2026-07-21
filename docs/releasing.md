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

## 发布新版本

1. 同步修改以下三个版本号：
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. 运行 `pnpm version:check`。
3. 提交版本修改并创建匹配的 Tag，例如版本 `0.2.0` 对应 `v0.2.0`。
4. 推送 Tag。GitHub Actions 将构建 macOS Universal、Windows x64、更新签名和 `latest.json`。
5. 打开 GitHub 草稿 Release，检查安装包、签名文件和更新说明。
6. 手动发布草稿。只有发布后的 Release 会被 FleurTerm 客户端发现。

## 本地开发

本地开发和普通调试构建默认不启用联网更新检查。发布工作流设置 `VITE_UPDATER_ENABLED=true`，正式安装包才会在启动时静默检查更新。浏览器预览会显示“不支持更新”，不会调用 Tauri 插件。

## 安全要求

- 不得提交私钥、证书、Token、Apple 密码或 GitHub Secrets。
- 不得在日志中打印上述内容。
- 不得发布 `latest.json` 与安装包签名不匹配的 Release。
- Release 必须先以草稿形式检查，再由仓库所有者手动发布。
