export type AiToolCallStatus =
  'proposed' | 'approved' | 'denied' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';

export type AiCommandRisk = 'safe' | 'risky' | 'unknown';

export interface AiTerminalToolCall {
  id: string;
  type: 'terminal.command';
  command: string;
  targetSessionId: string | null;
  risk: AiCommandRisk;
  status: AiToolCallStatus;
  output: string;
  errorMessage: string | null;
  truncated: boolean;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface AiToolResult {
  callId: string;
  outcome: 'completed' | 'partial' | 'denied' | 'failed' | 'cancelled';
  command: string;
  output: string;
  truncated: boolean;
  errorMessage?: string;
}

export type AiAppAction =
  | { type: 'terminal.write'; input: string }
  | { type: 'terminal.activate'; target: string }
  | { type: 'terminal.openLocal'; shell?: string; cwd?: string; title?: string }
  | {
      type: 'terminal.openSsh';
      host: string;
      user: string;
      port?: number;
      title?: string;
    }
  | { type: 'settings.updateTerminal'; patch: Record<string, unknown> }
  | { type: 'settings.updateAi'; patch: Record<string, unknown> }
  | { type: 'settings.setLocale'; locale: 'en-US' | 'zh-CN' }
  | { type: 'settings.open' };

export interface ParsedAiAppAction {
  id: string;
  action: AiAppAction;
}

export interface ParsedAssistantToolResponse {
  displayContent: string;
  toolCalls: AiTerminalToolCall[];
  appActions: ParsedAiAppAction[];
}

const TERMINAL_COMMAND_TAG_PATTERN = /<terminal-command>([\s\S]*?)<\/terminal-command>/gi;
const TERMINAL_CODE_BLOCK_PATTERN =
  /```(?:terminal|shell|bash|sh|powershell|pwsh)\s*\n([\s\S]*?)```/gi;
const APP_ACTION_TAG_PATTERN = /<fleurterm-action>([\s\S]*?)<\/fleurterm-action>/gi;
const MAX_TOOL_RESULT_OUTPUT_LENGTH = 12_000;

export function parseAssistantToolResponse(content: string): ParsedAssistantToolResponse {
  const toolCalls: AiTerminalToolCall[] = [];
  const appActions: ParsedAiAppAction[] = [];
  const withCodeBlockCommands = content.replace(
    TERMINAL_CODE_BLOCK_PATTERN,
    (matchedBlock, command) => {
      appendToolCall(toolCalls, command);
      return matchedBlock;
    },
  );
  const displayContent = withCodeBlockCommands
    .replace(TERMINAL_COMMAND_TAG_PATTERN, (_matchedTag, command) => {
      appendToolCall(toolCalls, command);
      return `${commandBlockText(command)}\n`;
    })
    .replace(APP_ACTION_TAG_PATTERN, (_matchedTag, source) => {
      appendAppAction(appActions, source);
      return '';
    });

  return { displayContent: displayContent.trim(), toolCalls, appActions };
}

export function formatToolResultMessage(result: AiToolResult): string {
  const boundedOutput = result.output.slice(-MAX_TOOL_RESULT_OUTPUT_LENGTH);
  const lines = [
    `Tool call ${result.callId} ${result.outcome}.`,
    `Command: ${result.command}`,
    `Output${result.truncated ? ' (truncated)' : ''}:`,
    boundedOutput || '(no output)',
  ];
  if (result.errorMessage) {
    lines.push(`Error: ${result.errorMessage}`);
  }
  return lines.join('\n');
}

function appendToolCall(toolCalls: AiTerminalToolCall[], rawCommand: string): void {
  const command = normalizeCommand(rawCommand);
  if (!command) {
    return;
  }
  toolCalls.push({
    id: `terminal-command-${toolCalls.length}-${hashCommand(command)}`,
    type: 'terminal.command',
    command,
    targetSessionId: null,
    risk: 'unknown',
    status: 'proposed',
    output: '',
    errorMessage: null,
    truncated: false,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
  });
}

function normalizeCommand(command: string): string {
  return command
    .replace(/^\s*```\w*\s*/g, '')
    .replace(/\s*```\s*$/g, '')
    .trim();
}

function commandBlockText(command: string): string {
  const normalizedCommand = normalizeCommand(command);
  return normalizedCommand ? `\`\`\`terminal\n${normalizedCommand}\n\`\`\`` : '';
}

function hashCommand(command: string): string {
  let hash = 0;
  for (const character of command) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16);
}

function appendAppAction(appActions: ParsedAiAppAction[], source: string): void {
  const action = parseAppAction(source);
  if (action === null) {
    return;
  }
  appActions.push({
    id: `app-action-${appActions.length}-${hashCommand(JSON.stringify(action))}`,
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
      case 'terminal.activate':
        return typeof parsed.target === 'string' && parsed.target.trim()
          ? { type: 'terminal.activate', target: parsed.target.trim() }
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
  const parsedNumber = Number(value);
  return Number.isFinite(parsedNumber) ? parsedNumber : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
