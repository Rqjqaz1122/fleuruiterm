import { parseAssistantToolResponse } from './aiToolProtocol';

import type {
  ParsedAiAppAction,
  ParsedAssistantToolResponse,
} from './aiToolProtocol';

export type { AiAppAction, ParsedAiAppAction } from './aiToolProtocol';

export interface ParsedAiTerminalCommand {
  id: string;
  command: string;
}

export interface ParsedAiAssistantContent {
  displayContent: string;
  terminalCommands: ParsedAiTerminalCommand[];
  appActions: ParsedAiAppAction[];
}

export function parseAiAssistantContent(content: string): ParsedAiAssistantContent {
  const parsedResponse = parseAssistantToolResponse(content);
  return {
    displayContent: parsedResponse.displayContent,
    terminalCommands: toTerminalCommands(parsedResponse),
    appActions: parsedResponse.appActions,
  };
}

function toTerminalCommands(
  parsedResponse: ParsedAssistantToolResponse,
): ParsedAiTerminalCommand[] {
  return parsedResponse.toolCalls.map(({ id, command }) => ({ id, command }));
}
