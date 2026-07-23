import { describe, expect, it } from 'vitest';

import { formatToolResultMessage, parseAssistantToolResponse } from './aiToolProtocol';

describe('AI tool protocol', () => {
  it('creates a stable terminal tool call and removes the raw tag from visible text', () => {
    const response = parseAssistantToolResponse(
      'Checking.\n<terminal-command>pwd</terminal-command>',
    );

    expect(response.displayContent).toContain('```terminal\npwd\n```');
    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        type: 'terminal.command',
        command: 'pwd',
        status: 'proposed',
      }),
    ]);
  });

  it('formats a result with the call id, outcome, command, and output', () => {
    const message = formatToolResultMessage({
      callId: 'call-1',
      outcome: 'completed',
      command: 'pwd',
      output: '/Users/fleurui',
      truncated: false,
    });

    expect(message).toContain('Tool call call-1 completed');
    expect(message).toContain('Command: pwd');
    expect(message).toContain('/Users/fleurui');
  });

  it('parses an action that activates an existing terminal without creating one', () => {
    const response = parseAssistantToolResponse(
      '<fleurterm-action>{"type":"terminal.activate","target":"production"}</fleurterm-action>',
    );

    expect(response.appActions).toEqual([
      expect.objectContaining({
        action: { type: 'terminal.activate', target: 'production' },
      }),
    ]);
  });

  it('parses an action that opens a saved connection', () => {
    const response = parseAssistantToolResponse(
      '<fleurterm-action>{"type":"connection.open","target":"10.7.121.72"}</fleurterm-action>',
    );

    expect(response.appActions).toEqual([
      expect.objectContaining({
        action: { type: 'connection.open', target: '10.7.121.72' },
      }),
    ]);
  });
});
