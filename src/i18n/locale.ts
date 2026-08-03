import { readonly, ref } from 'vue';

export type AppLocale = 'en-US' | 'zh-CN';

const LOCALE_STORAGE_KEY = 'fleurterm.locale';

const englishMessages = {
  'tabs.openTabs': 'Open tabs',
  'tabs.settings': 'Settings',
  'tabs.ai': 'AI',
  'tabs.newTerminal': 'New terminal',
  'tabs.openSettings': 'Open settings',
  'tabs.openAI': 'Open AI panel',
  'tabs.close': 'Close',
  'app.retry': 'Retry',
  'error.openTerminal': 'Unable to open terminal',
  'error.closeTerminal': 'Unable to close terminal',
  'error.closeTab': 'Unable to close terminal tab',
  'error.writeTerminal': 'Unable to write to terminal',
  'error.terminalBridge': 'Terminal communication failed',
  'error.persistWorkspace': 'Unable to save terminal workspace',
  'start.caption': 'Terminal workspace by FleurUI',
  'start.getStarted': 'Get started',
  'start.profiles': 'Profiles & connections',
  'start.profilesDescription': 'Configure shells and remote hosts',
  'start.newTerminal': 'New terminal',
  'start.opening': 'Opening…',
  'start.newTerminalDescription': 'Open the default local shell',
  'start.recent': 'Recent connections',
  'start.recentDescription': 'Reopen a previous session',
  'start.settings': 'Settings',
  'start.settingsDescription': 'Appearance, terminal and shortcuts',
  'settings.aria': 'Settings',
  'settings.sections': 'Settings sections',
  'settings.general': 'General',
  'settings.appearance': 'Appearance',
  'settings.terminal': 'Terminal',
  'settings.profiles': 'Profiles & connections',
  'settings.hotkeys': 'Hotkeys',
  'settings.ai': 'AI',
  'settings.generalDescription': 'Application startup and window behaviour.',
  'settings.language': 'Language',
  'settings.languageDescription': 'Language used by the application interface.',
  'settings.english': 'English',
  'settings.chinese': '简体中文',
  'settings.openOnStartup': 'Open a terminal on startup',
  'settings.openOnStartupDescription': 'Use the default profile.',
  'settings.appearanceDescription': 'Theme, type and window presentation.',
  'settings.theme': 'Theme',
  'settings.themeDescription': 'Application colour scheme.',
  'settings.interfaceFont': 'Interface font',
  'settings.interfaceFontDescription': 'Used outside the terminal.',
  'settings.windowOpacity': 'Window opacity',
  'settings.windowOpacityDescription': 'Opaque by default.',
  'settings.terminalDescription': 'Shell rendering and scrollback.',
  'settings.fontFamily': 'Font family',
  'settings.fontFamilyDescription': 'Terminal monospace font.',
  'settings.fontSize': 'Font size',
  'settings.fontSizeDescription': 'Measured in pixels.',
  'settings.cursorBlink': 'Cursor blink',
  'settings.cursorBlinkDescription': 'Animate the terminal cursor.',
  'settings.scrollback': 'Scrollback',
  'settings.scrollbackDescription': 'Number of lines kept in the buffer.',
  'settings.scrollOnInput': 'Scroll on input',
  'settings.scrollOnInputDescription': 'Scroll to the bottom when typing.',
  'settings.profilesDescription': 'Shell profiles and remote hosts.',
  'settings.localShell': 'Local shell',
  'settings.localShellDescription': 'Default system login shell.',
  'settings.default': 'Default',
  'settings.hotkeysDescription': 'Keyboard shortcuts for terminal actions.',
  'settings.closeTab': 'Close tab',
  'settings.closeTabDescription': 'Close the active terminal tab.',
  'settings.aiDescription': 'Assistant presentation and context controls.',
  'settings.aiAssistant': 'AI assistant',
  'settings.aiAssistantDescription': 'Show assistant controls in terminal sessions.',
  'pane.terminal': 'Terminal',
  'pane.local': 'Local',
  'pane.splitHorizontal': 'Split horizontally',
  'pane.splitVertical': 'Split vertically',
  'pane.close': 'Close pane',
  'terminal.disconnected': 'Terminal connection closed. Press Enter to reconnect.',
  'terminal.reconnecting': 'Reconnecting…',
  'terminal.reconnectFailed': 'Reconnect failed. Press Enter to try again.',
  'contextMenu.cut': 'Cut',
  'contextMenu.copy': 'Copy',
  'contextMenu.paste': 'Paste',
  'contextMenu.selectAll': 'Select All',
  'contextMenu.clearTerminal': 'Clear Terminal',
  'sftp.open': 'SFTP',
  'sftp.title': 'SFTP',
  'sftp.close': 'Close SFTP',
  'sftp.parent': 'Parent directory',
  'sftp.refresh': 'Refresh',
  'sftp.upload': 'Upload files',
  'sftp.download': 'Download',
  'sftp.delete': 'Delete',
  'sftp.deleteTitle': 'Delete remote entry',
  'sftp.deleteWarning':
    'This permanently deletes the selected file or directory and all of its contents. This action cannot be undone.',
  'sftp.selectedEntry': 'Selected',
  'sftp.cancel': 'Cancel',
  'sftp.retry': 'Retry',
  'sftp.name': 'Name',
  'sftp.size': 'Size',
  'sftp.modified': 'Modified',
  'sftp.permissions': 'Permissions',
  'sftp.connecting': 'Connecting to SFTP…',
  'sftp.loading': 'Loading directory…',
  'sftp.empty': 'This directory is empty',
  'sftp.uploading': 'Uploading files…',
  'sftp.downloading': 'Downloading file…',
  'sftp.uploadComplete': 'Upload complete',
  'sftp.downloadComplete': 'Download complete',
  'sftp.failed': 'Unable to complete the SFTP operation',
  'sftp.errorAuthentication': 'Unable to authenticate the SFTP connection',
  'sftp.errorUnknownHostKey': 'Connect in the terminal and accept the server host key first',
  'sftp.errorHostKeyMismatch': 'The server host key does not match known_hosts',
  'sftp.errorConnection': 'Unable to connect to the SFTP server',
  'sftp.errorSession': 'The SFTP session is no longer available',
  'sftp.errorRemote': 'The remote SFTP operation failed',
  'sftp.errorLocal': 'The local file operation failed',
  'status.aria': 'Terminal status',
  'status.noSession': 'No session',
  'status.localShell': 'Local shell',
  'status.created': 'Created',
  'status.starting': 'Starting',
  'status.ready': 'Ready',
  'status.closing': 'Closing',
  'status.closed': 'Closed',
  'status.failed': 'Failed',
} as const;

export type TranslationKey = keyof typeof englishMessages;

const chineseMessages: Record<TranslationKey, string> = {
  'tabs.openTabs': '打开的标签',
  'tabs.settings': '设置',
  'tabs.ai': 'AI',
  'tabs.newTerminal': '新建终端',
  'tabs.openSettings': '打开设置',
  'tabs.openAI': '打开 AI 面板',
  'tabs.close': '关闭',
  'app.retry': '重试',
  'error.openTerminal': '无法打开终端',
  'error.closeTerminal': '无法关闭终端',
  'error.closeTab': '无法关闭终端标签',
  'error.writeTerminal': '无法写入终端',
  'error.terminalBridge': '终端通信失败',
  'error.persistWorkspace': '无法保存终端工作区',
  'start.caption': 'FleurUI 终端工作区',
  'start.getStarted': '开始使用',
  'start.profiles': '配置与连接',
  'start.profilesDescription': '配置 Shell 和远程主机',
  'start.newTerminal': '新建终端',
  'start.opening': '正在打开…',
  'start.newTerminalDescription': '打开默认本地 Shell',
  'start.recent': '最近连接',
  'start.recentDescription': '重新打开之前的会话',
  'start.settings': '设置',
  'start.settingsDescription': '外观、终端和快捷键',
  'settings.aria': '设置',
  'settings.sections': '设置分类',
  'settings.general': '常规',
  'settings.appearance': '外观',
  'settings.terminal': '终端',
  'settings.profiles': '配置与连接',
  'settings.hotkeys': '快捷键',
  'settings.ai': 'AI',
  'settings.generalDescription': '应用启动与窗口行为。',
  'settings.language': '语言',
  'settings.languageDescription': '应用界面使用的语言。',
  'settings.english': 'English',
  'settings.chinese': '简体中文',
  'settings.openOnStartup': '启动时打开终端',
  'settings.openOnStartupDescription': '使用默认配置。',
  'settings.appearanceDescription': '主题、字体与窗口显示。',
  'settings.theme': '主题',
  'settings.themeDescription': '应用界面配色。',
  'settings.interfaceFont': '界面字体',
  'settings.interfaceFontDescription': '用于终端之外的界面。',
  'settings.windowOpacity': '窗口透明度',
  'settings.windowOpacityDescription': '默认完全不透明。',
  'settings.terminalDescription': 'Shell 渲染与回滚缓冲。',
  'settings.fontFamily': '字体',
  'settings.fontFamilyDescription': '终端等宽字体。',
  'settings.fontSize': '字号',
  'settings.fontSizeDescription': '单位为像素。',
  'settings.cursorBlink': '光标闪烁',
  'settings.cursorBlinkDescription': '启用终端光标动画。',
  'settings.scrollback': '回滚缓冲',
  'settings.scrollbackDescription': '缓冲区保留的行数。',
  'settings.scrollOnInput': '输入时滚动',
  'settings.scrollOnInputDescription': '输入内容时滚动到底部。',
  'settings.profilesDescription': 'Shell 配置和远程主机。',
  'settings.localShell': '本地 Shell',
  'settings.localShellDescription': '默认系统登录 Shell。',
  'settings.default': '默认',
  'settings.hotkeysDescription': '终端操作快捷键。',
  'settings.closeTab': '关闭标签',
  'settings.closeTabDescription': '关闭当前终端标签。',
  'settings.aiDescription': '助手展示与上下文控制。',
  'settings.aiAssistant': 'AI 助手',
  'settings.aiAssistantDescription': '在终端会话中显示助手控件。',
  'pane.terminal': '终端',
  'pane.local': '本地',
  'pane.splitHorizontal': '水平分屏',
  'pane.splitVertical': '垂直分屏',
  'pane.close': '关闭面板',
  'terminal.disconnected': '终端连接已断开，按回车重新连接。',
  'terminal.reconnecting': '正在重新连接…',
  'terminal.reconnectFailed': '重新连接失败，按回车再次尝试。',
  'contextMenu.cut': '剪切',
  'contextMenu.copy': '复制',
  'contextMenu.paste': '粘贴',
  'contextMenu.selectAll': '全选',
  'contextMenu.clearTerminal': '清空终端',
  'sftp.open': 'SFTP',
  'sftp.title': 'SFTP',
  'sftp.close': '关闭 SFTP',
  'sftp.parent': '上级目录',
  'sftp.refresh': '刷新',
  'sftp.upload': '上传文件',
  'sftp.download': '下载',
  'sftp.delete': '删除',
  'sftp.deleteTitle': '删除远程项目',
  'sftp.deleteWarning': '这会永久删除所选文件或目录及其全部内容，此操作无法撤销。',
  'sftp.selectedEntry': '已选择',
  'sftp.cancel': '取消',
  'sftp.retry': '重试',
  'sftp.name': '名称',
  'sftp.size': '大小',
  'sftp.modified': '修改时间',
  'sftp.permissions': '权限',
  'sftp.connecting': '正在连接 SFTP…',
  'sftp.loading': '正在读取目录…',
  'sftp.empty': '此目录为空',
  'sftp.uploading': '正在上传文件…',
  'sftp.downloading': '正在下载文件…',
  'sftp.uploadComplete': '上传完成',
  'sftp.downloadComplete': '下载完成',
  'sftp.failed': '无法完成 SFTP 操作',
  'sftp.errorAuthentication': '无法验证 SFTP 连接身份',
  'sftp.errorUnknownHostKey': '请先在终端连接并确认服务器主机密钥',
  'sftp.errorHostKeyMismatch': '服务器主机密钥与 known_hosts 不一致',
  'sftp.errorConnection': '无法连接到 SFTP 服务器',
  'sftp.errorSession': 'SFTP 会话已不可用',
  'sftp.errorRemote': '远程 SFTP 操作失败',
  'sftp.errorLocal': '本地文件操作失败',
  'status.aria': '终端状态',
  'status.noSession': '无会话',
  'status.localShell': '本地 Shell',
  'status.created': '已创建',
  'status.starting': '正在启动',
  'status.ready': '就绪',
  'status.closing': '正在关闭',
  'status.closed': '已关闭',
  'status.failed': '失败',
};

const messages: Record<AppLocale, Record<TranslationKey, string>> = {
  'en-US': englishMessages,
  'zh-CN': chineseMessages,
};

const activeLocale = ref<AppLocale>(readStoredLocale());

if (typeof document !== 'undefined') {
  document.documentElement.lang = activeLocale.value;
}

export const locale = readonly(activeLocale);

export function t(key: TranslationKey): string {
  return messages[activeLocale.value][key];
}

export function setLocale(nextLocale: AppLocale): void {
  activeLocale.value = nextLocale;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = nextLocale;
  }
}

export function terminalTitle(index: number): string {
  return activeLocale.value === 'zh-CN' ? `终端 ${index}` : `Terminal ${index}`;
}

function readStoredLocale(): AppLocale {
  if (typeof localStorage !== 'undefined') {
    const storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (storedLocale === 'zh-CN' || storedLocale === 'en-US') {
      return storedLocale;
    }
  }

  if (typeof navigator !== 'undefined') {
    const preferredLanguages = [navigator.language, ...navigator.languages];
    return preferredLanguages.some((language) => language.toLowerCase().startsWith('zh'))
      ? 'zh-CN'
      : 'en-US';
  }

  return 'en-US';
}
