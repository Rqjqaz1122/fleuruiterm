# macOS SSH 密码持久化设计

日期：2026-07-21

## 根因

前端已经通过 Tauri 命令保存、读取和删除连接密码，但 Rust 后端只有 Windows 凭据管理器实现；macOS 命中非 Windows 占位函数，保存操作无副作用，读取始终返回空值。

## 目标

- macOS 使用系统 Keychain 保存 SSH 连接密码。
- 普通设置文件和 localStorage 继续只保存 `hasPassword`，不得保存明文密码。
- 保持 Windows 凭据管理器现有行为不变。
- 删除连接或忘记密码时同步删除 Keychain 项。

## 架构

新增聚焦的 `credentials` Rust 模块，统一暴露批量读取、保存和删除连接密码。Windows 实现迁入该模块；macOS 使用 `security-framework` 的 generic password API，service 固定为 `FleurTerm`，account 使用稳定的连接密码目标名。Linux 等未支持平台继续返回无凭据，但不伪装为已持久化成功。

## 错误处理

- Keychain 项不存在时按“未保存密码”处理。
- UTF-8 解码、Keychain 访问和写入失败返回错误给 Tauri 命令。
- 前端不记录或展示密码内容。

## 验证

- 使用内存假后端测试批量加载、缺失项过滤和错误传播。
- 在 macOS 目标上编译 Keychain 实现。
- 运行 Rust、前端、静态检查和 Tauri 调试构建。
