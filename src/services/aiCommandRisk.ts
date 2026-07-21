import type { AiCommandRisk } from './aiToolProtocol';

const SAFE_COMMAND_PREFIXES = [
  'pwd',
  'ls',
  'dir',
  'cat',
  'head',
  'tail',
  'find',
  'rg',
  'grep',
  'git status',
  'git diff',
  'git log',
  'get-childitem',
  'get-content',
];

const RISKY_COMMAND_PATTERN =
  /(?:^|\s)(?:rm|rmdir|del|erase|mv|cp|chmod|chown|sudo|npm\s+(?:install|publish)|pnpm\s+(?:add|install|publish)|git\s+(?:push|commit|reset|checkout|switch|clean)|curl|wget|invoke-webrequest|ssh|scp)(?:\s|$)/i;
const COMPOUND_COMMAND_PATTERN = /[;&|>`$\r\n]/;

export function classifyTerminalCommand(command: string): AiCommandRisk {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return 'unknown';
  }
  if (RISKY_COMMAND_PATTERN.test(normalizedCommand)) {
    return 'risky';
  }
  if (COMPOUND_COMMAND_PATTERN.test(normalizedCommand)) {
    return 'unknown';
  }

  const lowerCaseCommand = normalizedCommand.toLowerCase();
  const isSafeCommand = SAFE_COMMAND_PREFIXES.some(
    (candidate) => lowerCaseCommand === candidate || lowerCaseCommand.startsWith(`${candidate} `),
  );
  return isSafeCommand ? 'safe' : 'unknown';
}
