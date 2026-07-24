import { describe, expect, it } from 'vitest';

import { parseAiAssistantContent } from './aiTerminalCommands';

describe('parseAiAssistantContent', () => {
  it('extracts terminal command tags and keeps readable assistant output', () => {
    const parsed = parseAiAssistantContent(
      'Run this:\n<terminal-command>pwd</terminal-command>\nThen inspect the output.',
    );

    expect(parsed.terminalCommands).toEqual([
      expect.objectContaining({
        command: 'pwd',
      }),
    ]);
    expect(parsed.displayContent).toContain('```terminal\npwd\n```');
    expect(parsed.displayContent).not.toContain('<terminal-command>');
  });

  it('keeps generated terminal code fences separate from adjacent prose', () => {
    const parsed = parseAiAssistantContent(
      '<terminal-command>dir</terminal-command>已请求在当前本地终端执行 `dir` 命令。',
    );

    expect(parsed.displayContent).toBe(
      '```terminal\ndir\n```\n已请求在当前本地终端执行 `dir` 命令。',
    );
  });

  it('keeps shell code blocks as display-only content', () => {
    const parsed = parseAiAssistantContent('```bash\nls -la\n```');

    expect(parsed.terminalCommands).toEqual([]);
    expect(parsed.displayContent).toBe('```bash\nls -la\n```');
  });

  it('extracts FleurTerm app actions and removes action tags from display text', () => {
    const parsed = parseAiAssistantContent(
      'I will update it.\n<fleurterm-action>{"type":"settings.updateTerminal","patch":{"fontSize":16}}</fleurterm-action>',
    );

    expect(parsed.appActions).toEqual([
      expect.objectContaining({
        action: {
          type: 'settings.updateTerminal',
          patch: { fontSize: 16 },
        },
      }),
    ]);
    expect(parsed.displayContent).toBe('I will update it.');
  });
});
