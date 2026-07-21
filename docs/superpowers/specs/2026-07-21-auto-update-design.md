# FleurTerm 自动更新设计

日期：2026-07-21

## 目标

为 FleurTerm 增加基于 Tauri 2 Updater 和公开 GitHub Releases 的桌面端自动更新能力，覆盖 macOS 与 Windows。应用启动后静默检查一次更新，用户也可以在设置页手动检查、查看版本说明、下载更新并重启安装。更新不得强制下载或静默安装。

## 发布边界

- 源码与安装包发布仓库固定为 `Rqjqaz1122/fleuruiterm`。
- 仓库必须保持公开，更新地址固定为 `https://github.com/Rqjqaz1122/fleuruiterm/releases/latest/download/latest.json`。
- Git Tag 使用 `v<major>.<minor>.<patch>`，例如 `v0.2.0`。
- GitHub Actions 根据 Tag 创建草稿 Release。用户检查安装包和更新说明后手动发布，只有已发布的最新 Release 会被客户端发现。
- 首期发布 macOS Universal 与 Windows 桌面安装包，不实现增量更新、更新通道、强制更新或后台自动下载。

## 应用交互

设置页“通用”区域新增独立的软件更新卡片，包含当前版本和一个主操作按钮。更新状态使用以下有限状态：

- `idle`：尚未检查，可手动检查。
- `checking`：正在检查，禁用重复操作。
- `upToDate`：当前已是最新版本。
- `available`：显示新版本号、发布时间与更新说明，可开始下载。
- `downloading`：显示已下载字节数和可计算的百分比。
- `installing`：安装处理中，禁用重复操作。
- `error`：显示不含敏感信息的错误，可重新检查。
- `unsupported`：浏览器预览或当前平台不支持更新，仅展示当前版本。

应用启动后只执行一次静默检查。没有更新时不弹窗；发现更新时保留在全局更新状态中，并由设置页卡片展示。用户点击“下载并安装”后才下载，安装完成后调用 Tauri Process 插件重启 FleurTerm。

## 代码结构

### 更新客户端

新增聚焦的 `appUpdater` 服务，封装 Tauri Updater、Process 和应用版本 API。它对上层暴露：

- 获取当前版本。
- 检查更新并返回标准化的版本信息。
- 下载并安装，同时上报进度。
- 重启应用。

浏览器预览环境返回 `unsupported`，不得抛出未处理异常。组件和状态层不直接依赖 Tauri 插件，以便测试替换更新客户端。

### 更新状态

新增独立 Pinia 更新 Store，负责状态迁移、并发保护、错误转换和启动检查去重。Store 持有插件返回的待安装更新对象，但不持久化该对象或下载进度。应用重新启动后重新检查。

### 设置界面

新增独立 `SoftwareUpdateCard` 组件，由设置页通用区域引用。组件只消费更新 Store 并触发检查或安装动作，不承载插件调用和发布逻辑。中英文文案都必须完整提供，并沿用当前设置页的黑灰色视觉体系。

## Tauri 配置

- 添加 `tauri-plugin-updater`、`tauri-plugin-process` 及对应前端包。
- 在 Rust Builder 注册两个插件。
- 在 Capability 中授予更新检查、下载、安装和重启所需的最小权限。
- 在 `tauri.conf.json` 中启用 `createUpdaterArtifacts`，配置公开更新端点和更新公钥。
- 更新签名私钥不得写入仓库、前端代码、配置文件或日志。

## 签名与发布流水线

更新签名使用 Tauri 独立签名密钥。公钥进入应用配置，私钥和密码进入 GitHub Actions Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

macOS Release 还必须使用 Apple Developer 证书签名并完成公证；相关证书、密码、Apple ID 凭据和 Team ID 只能保存在 GitHub Secrets。没有完整 macOS 签名材料时，流水线不得发布可被客户端识别为正式更新的 macOS 产物。

GitHub Actions 使用官方 `tauri-apps/tauri-action` 构建 macOS Universal 与 Windows 产物，生成签名文件和 `latest.json`，并创建草稿 Release。流水线在构建前校验 `package.json`、`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 的版本一致。

## 错误处理

- 网络失败、清单格式错误、签名错误、下载失败和安装失败都进入 `error` 状态，并保留重新检查入口。
- 用户可见错误不得包含签名私钥、令牌、文件系统敏感路径或完整底层堆栈。
- 重复点击检查或安装不得创建并行任务。
- 静默启动检查失败不弹出阻断对话框，只在设置页显示错误状态。
- 下载过程中关闭应用时不承诺断点续传，下次启动重新检查。

## 测试与验收

- 更新服务测试覆盖浏览器环境降级和插件结果标准化。
- 更新 Store 测试覆盖无更新、有更新、并发检查、下载进度、安装失败和重启调用。
- 更新卡片测试覆盖各状态文案、按钮禁用与中英文展示。
- App 测试覆盖启动只触发一次静默检查。
- 运行完整前端测试、类型检查、lint、生产构建、Rust 测试与 Tauri 调试构建。
- 使用草稿 Release 验证产物齐全；发布一个高于当前版本的测试 Release 后，在已安装的旧版本上验证检查、下载、签名验证、安装和重启全流程。

## 明确不包含

- 不自动修改 GitHub 仓库可见性。
- 不自动创建或上传签名密钥。
- 不替用户购买或配置 Apple Developer 账号。
- 不自动发布草稿 Release。
- 不实现夜间版、测试版或多更新通道。
