export interface ParsedAiTerminalCommand {
  id: string;
  command: string;
}

export type AiAppAction =
  | { type: 'terminal.write'; input: string }
  | { type: 'terminal.openLocal'; shell?: string; cwd?: string; title?: string }
  | {
      type: 'terminal.openSsh';
      host: string;
      user: string;
      port?: number;
      title?: string;
    }
  | {
      type: 'settings.updateTerminal';
      patch: Record<string, unknown>;
    }
  | {
      type: 'settings.updateAi';
      patch: Record<string, unknown>;
    }
  | {
      type: 'settings.setLocale';
      locale: 'en-US' | 'zh-CN';
    }
  | { type: 'settings.open' };

export interface ParsedAiAppAction {
  id: string;
  action: AiAppAction;
}

export interface ParsedAiAssistantContent {
  displayContent: string;
  terminalCommands: ParsedAiTerminalCommand[];
  appActions: ParsedAiAppAction[];
}

const TERMINAL_COMMAND_TAG_PATTERN = /<terminal-command>([\s\S]*?)<\/terminal-command>/gi;
const TERMINAL_CODE_BLOCK_PATTERN = /```(?:terminal|shell|bash|sh|powershell|pwsh)\s*\n([\s\S]*?)```/gi;
const APP_ACTION_TAG_PATTERN = /<fleurterm-action>([\s\S]*?)<\/fleurterm-action>/gi;

export function parseAiAssistantContent(content: string): ParsedAiAssistantContent {
  const terminalCommands: ParsedAiTerminalCommand[] = [];
  const appActions: ParsedAiAppAction[] = [];
  const withCodeBlockCommands = content.replace(
    TERMINAL_CODE_BLOCK_PATTERN,
    (match, command) => {
      appendCommand(terminalCommands, command);
      return match;
    },
  );
  const displayContent = withCodeBlockCommands.replace(
    TERMINAL_COMMAND_TAG_PATTERN,
    (_match, command) => {
      appendCommand(terminalCommands, command);
      return `${commandBlockText(command)}\n`;
    },
  ).replace(APP_ACTION_TAG_PATTERN, (_match, source) => {
    appendAppAction(appActions, source);
    return '';
  });
  return { displayContent: displayContent.trim(), terminalCommands, appActions };
}

function appendCommand(commands: ParsedAiTerminalCommand[], rawCommand: string): void {
  const command = normalizeCommand(rawCommand);
  if (!command) {
    return;
  }
  commands.push({
    id: `terminal-command-${commands.length}-${hashCommand(command)}`,
    command,
  });
}

function normalizeCommand(command: string): string {
  return command
    .replace(/^\s*```\w*\s*/g, '')
    .replace(/\s*```\s*$/g, '')
    .trim();
}

function commandBlockText(command: string): string {
  const normalized = normalizeCommand(command);
  return normalized ? `\`\`\`terminal\n${normalized}\n\`\`\`` : '';
}

function hashCommand(command: string): string {
  let hash = 0;
  for (const character of command) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16);
}

function appendAppAction(actions: ParsedAiAppAction[], source: string): void {
  const action = parseAppAction(source);
  if (action === null) {
    return;
  }
  actions.push({
    id: `app-action-${actions.length}-${hashCommand(JSON.stringify(action))}`,
    action,
  });
}

function parseAppAction(source: string): AiAppAction | null {
  try {
    const parsed = JSON.parse(source.trim()) as Record<string, unknown>;
    switch (parsed.type) {
      case 'terminal.write':
        return typeof parsed.input === 'string'
          ? { type: 'terminal.write', input: parsed.input }
          : null;
      case 'terminal.openLocal':
        return {
          type: 'terminal.openLocal',
          shell: stringOrUndefined(parsed.shell),
          cwd: stringOrUndefined(parsed.cwd),
          title: stringOrUndefined(parsed.title),
        };
      case 'terminal.openSsh':
        return typeof parsed.host === 'string' && typeof parsed.user === 'string'
          ? {
              type: 'terminal.openSsh',
              host: parsed.host,
              user: parsed.user,
              port: numberOrUndefined(parsed.port),
              title: stringOrUndefined(parsed.title),
            }
          : null;
      case 'settings.updateTerminal':
        return isObjectRecord(parsed.patch)
          ? { type: 'settings.updateTerminal', patch: parsed.patch }
          : null;
      case 'settings.updateAi':
        return isObjectRecord(parsed.patch)
          ? { type: 'settings.updateAi', patch: parsed.patch }
          : null;
      case 'settings.setLocale':
        return parsed.locale === 'en-US' || parsed.locale === 'zh-CN'
          ? { type: 'settings.setLocale', locale: parsed.locale }
          : null;
      case 'settings.open':
        return { type: 'settings.open' };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
