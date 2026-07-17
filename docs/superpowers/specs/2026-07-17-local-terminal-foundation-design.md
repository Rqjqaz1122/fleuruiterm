# FleurTerm 本地终端基础设计

> 日期：2026-07-17  
> 对应总体设计：`ai-ssh-terminal-design.md`  
> 交付范围：MVP 阶段 1 的首个可运行垂直切片

## 1. 目标

在空仓库中建立 FleurTerm 的可运行桌面应用基础，交付一个能够启动本地 Shell、显示实时终端输出、接收用户输入并支持标签页与横纵分屏的 macOS 开发版本。架构必须保留跨平台能力，并为后续 SSH、持久化、AI 上下文与安全策略提供稳定边界。

本阶段完成后，开发者应能使用 Node.js 22、pnpm 和 Rust stable 执行一组明确命令完成安装、测试、构建和启动。

## 2. 范围

### 2.1 本阶段包含

- Tauri 2、Vue 3、TypeScript 和 Vite 项目骨架。
- Node.js 22 项目版本约束、pnpm 包管理和统一质量命令。
- 深色优先的 FleurTerm 应用外壳。
- xterm.js 终端实例及 Fit Addon。
- Rust 侧统一会话领域模型和本地 PTY Backend。
- 本地 Shell 的打开、输入、resize、关闭和退出状态处理。
- 有界输出通道、批量发送、递增序列号和前端消费确认边界。
- 多标签页、活动标签切换、关闭和新建本地终端。
- 横向、纵向分屏以及面板关闭。
- 连接状态、当前 Shell 和会话状态展示。
- Rust 单元测试、前端单元测试和格式、Lint、类型检查。

### 2.2 本阶段不包含

- SSH、Host Key、密码、私钥、Agent 和跳板机。
- SQLite、Profile、Keychain 和布局持久化。
- AI Provider、Context Engine、Policy Engine 和审计。
- SFTP、端口转发、插件、自动更新和发布签名。
- 完整设置页面、主题编辑器和快捷键自定义。

这些能力继续遵循总体设计，但不会以空实现、占位按钮或无行为菜单提前进入代码。

## 3. 方案选择

### 3.1 采用：前后端垂直切片

从 Vue 终端视图穿过 Tauri IPC 到 Rust 本地 PTY，先打通一条真实工作路径。每个新增边界都可由自动化测试验证，后续 SSH Backend 可在不改变前端终端协议的前提下接入。

### 3.2 未采用：先建立全部模块空目录

该方案能快速形成总体结构，但会产生大量没有行为验证的抽象和占位代码，并增加后续重构成本。

### 3.3 未采用：先只制作静态 UI

静态界面无法验证 PTY、IPC、resize、生命周期和流量控制，而这些正是 Tauri 终端应用最早需要消除的工程风险。

## 4. 技术基线

- Node.js 22，由 `.nvmrc` 固定。
- pnpm workspace，前端依赖使用项目本地版本。
- Vue 3、TypeScript、Vite、Pinia。
- xterm.js 与 Fit Addon。
- Tauri 2、Tokio、portable-pty、serde、thiserror、tracing。
- Vitest、Vue Test Utils、ESLint、Prettier。
- Rustfmt、Clippy 和 Cargo test。

依赖采用实施时的稳定兼容版本，并通过 lockfile 固定。Tauri CLI 作为项目开发依赖安装，不依赖全局命令。

## 5. 架构

```text
Vue App Shell
  ├─ Workspace Store
  │    ├─ Tab Model
  │    └─ Split Tree
  ├─ Terminal Pane
  │    ├─ xterm.js Adapter
  │    └─ Session Client
  └─ Status Bar
           │
           ▼
       Tauri Commands + Channel
           │
           ▼
Rust Session Service
  ├─ Session Registry
  ├─ Session State Machine
  ├─ Local PTY Backend
  └─ Bounded Output Pump
```

### 5.1 前端边界

前端只持有展示状态、布局状态和不敏感的会话快照。终端组件不得创建系统进程，也不得接触 Shell 路径之外的本机能力。所有会话操作通过具名 IPC 方法进入 Rust。

终端实例生命周期绑定到 pane，而会话生命周期绑定到 tab/pane 引用。组件卸载时释放 xterm.js 资源；关闭最后一个引用时请求后端关闭对应会话。

### 5.2 Rust 边界

`SessionBackend` 表达打开、写入、resize、interrupt 和关闭语义。`LocalPtyBackend` 是本阶段唯一实现。会话注册表负责 ID、状态转换、资源所有权和关闭清理，不把 portable-pty 类型泄露到 IPC 层。

外部输入必须验证 Session ID、数据长度和终端尺寸。Rust 错误通过稳定错误码和可公开消息返回，内部原因进入不含敏感信息的 tracing 日志。

### 5.3 会话状态

本阶段使用有限状态集合：`Created`、`Starting`、`Ready`、`Closing`、`Closed`、`Failed`。状态转换集中在会话领域模块，UI 不自行推导后端状态。

## 6. 数据流

### 6.1 打开终端

1. 用户新建本地终端。
2. 前端建立接收输出的有界 Channel，并调用打开命令。
3. Rust 选择默认 Shell，创建 PTY 和子进程，注册 Session。
4. Rust 返回不含敏感信息的 SessionSnapshot。
5. 前端创建 tab、pane 和 xterm.js 实例，并显示 Ready 状态。

### 6.2 终端输出

1. PTY reader 将字节写入每会话有界队列。
2. 输出泵按时间窗或容量阈值聚合数据。
3. 每个批次带 `sessionId`、`sequence` 和 payload。
4. 前端按 sequence 校验顺序，将 payload 写入 xterm.js。
5. UI 消费速度不足时，有界队列形成背压，不允许内存无限增长。

### 6.3 输入与 resize

用户输入通过具名写入命令发送；后端限制单次 payload 长度并只写入已存在、可写的会话。终端尺寸必须为合理的正整数，并由 resize observer 与 Fit Addon 计算后发送。

## 7. UI 设计

界面采用深色、低装饰、高信息密度布局：顶部为品牌与标签区，中部为分屏终端工作区，底部为状态栏。标签显示标题、活动态、运行状态和关闭操作。分屏边框需明确当前焦点，但不能只依赖颜色表达状态。

首屏在没有终端时显示一个简洁空状态和“新建本地终端”主操作。创建后终端立即获得焦点。布局适配常见桌面窗口尺寸；窗口过小时保证终端可用，不追求移动端响应式。

本阶段不复制 Tabby 的品牌资产、图标或逐像素布局。

## 8. 错误与恢复

- Shell 无法启动：终端 pane 展示失败状态和可重试操作，应用保持运行。
- PTY 读写失败：会话转为 Failed，停止写入并释放资源。
- 子进程正常退出：会话转为 Closed，并在终端显示退出状态。
- IPC 参数非法：后端拒绝请求，不改变会话状态。
- 前端 pane 销毁：注销监听并释放 xterm.js；后端关闭请求保持幂等。
- 应用退出：统一关闭全部 PTY 和子进程，不在后台遗留 Shell。

## 9. 测试策略

### 9.1 Rust

- 先写失败测试，再实现会话状态合法转换和非法转换拒绝。
- 测试输入长度、终端尺寸和 Session ID 校验。
- 使用测试替身验证 registry 的打开、写入、resize 和关闭分派。
- 在 macOS 集成测试中启动可控 Shell，验证输出、输入和退出。

### 9.2 前端

- 测试 tab 新建、切换和关闭。
- 测试 split tree 的横向、纵向拆分与 pane 移除。
- 测试会话状态映射和错误展示。
- 对 xterm.js 使用窄适配边界，组件测试不模拟其内部实现。

### 9.3 质量门禁

- `pnpm test`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- `pnpm tauri build --debug`

## 10. 验收标准

- 在 macOS Apple Silicon 上可安装依赖、构建并启动 FleurTerm。
- 用户可以打开至少两个独立本地终端标签并在它们之间切换。
- 用户可以将工作区横向或纵向分屏，每个 pane 连接独立本地 Shell。
- 终端支持输入、连续输出、窗口 resize、关闭和进程退出。
- 关闭 pane、标签或应用后，不遗留对应子进程。
- 后端拒绝非法 Session ID、过大输入和非法尺寸。
- 高频输出通路使用有界队列，不存在无界事件堆积设计。
- 前端类型检查、单元测试、Lint 和生产构建通过。
- Rust 测试、格式检查、Clippy 和 Tauri debug 构建通过。
- 仓库中不包含凭据、生成产物、依赖目录或无行为占位模块。

## 11. 后续阶段接口

SSH Backend 后续实现同一 `SessionBackend` 语义；前端只根据 backend 类型和 snapshot 展示差异。Profile 与布局持久化后续围绕现有 workspace store 增加 repository，不让 UI 直接操作 SQLite。AI Context Engine 后续订阅会话语义事件，不读取 xterm.js 屏幕内容。
