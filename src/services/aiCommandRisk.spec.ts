import { describe, expect, it } from 'vitest';

import { classifyTerminalCommand } from './aiCommandRisk';

describe('classifyTerminalCommand', () => {
  it.each(['pwd', 'ls -la', 'git status', 'cat package.json', 'Get-ChildItem'])(
    '%s is safe',
    (command) => {
      expect(classifyTerminalCommand(command)).toBe('safe');
    },
  );

  it.each(['rm -rf dist', 'npm install', 'git push', 'sudo reboot', 'Invoke-WebRequest x'])(
    '%s is risky',
    (command) => {
      expect(classifyTerminalCommand(command)).toBe('risky');
    },
  );

  it('treats an unrecognized command as unknown', () => {
    expect(classifyTerminalCommand('custom-tool --apply')).toBe('unknown');
  });

  it('never auto-approves compound commands', () => {
    expect(classifyTerminalCommand('pwd && rm -rf dist')).toBe('risky');
    expect(classifyTerminalCommand('pwd | custom-tool')).toBe('unknown');
  });
});
