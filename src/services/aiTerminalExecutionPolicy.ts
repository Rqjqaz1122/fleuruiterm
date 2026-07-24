const EXPLICIT_TERMINAL_EXECUTION_PATTERNS = [
  /^(?:请|请你|帮我|麻烦你?)?(?:执行|运行)/,
  /(?:然后|接着|并且|并|再|随后)(?:请|帮我)?(?:执行|运行)/,
  /(?:可以|能否|能不能|请问可以)(?:帮我)?(?:执行|运行)/,
  /^\s*(?:please\s+)?(?:run|execute)\b/i,
  /\b(?:then|and|also|after that)\s+(?:please\s+)?(?:run|execute)\b/i,
  /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:run|execute)\b/i,
] as const;

const TERMINAL_COMMAND_REVIEW_PATTERNS = [
  /(?:刚才|之前|上次|当前|正在|已经|前面|上面).{0,16}(?:执行|运行).{0,10}(?:的)?(?:命令|指令).{0,8}(?:是什么|什么|哪个|哪些|哪条)/,
  /(?:执行|运行)(?:了|的)?.{0,8}(?:什么|哪个|哪些|哪条)(?:命令|指令)?/,
  /(?:什么|哪个|哪些|哪条)(?:命令|指令).{0,10}(?:被)?(?:执行|运行)/,
  /(?:解释|说明|分析).{0,8}(?:这个|该|刚才|之前|上面|以下)?(?:命令|指令)/,
  /(?:这个|该|刚才|之前|上面|以下)?(?:命令|指令).{0,8}(?:是什么|什么意思|含义|作用|为什么)/,
  /\b(?:what|which)\s+command\b.{0,80}\b(?:run|ran|execute|executed|running)\b/i,
  /\bwhat\b.{0,40}\b(?:did|have|are|were)\b.{0,40}\b(?:run|execute|executed|running)\b/i,
  /\b(?:explain|describe)\b.{0,80}\b(?:command|script)\b/i,
  /\bwhat\s+does\b.{0,80}\b(?:command|script)\b.{0,40}\b(?:do|mean)\b/i,
  /\b(?:show|tell)\b.{0,80}\bcommand\b.{0,40}\b(?:ran|executed|running)\b/i,
] as const;

export function permitsTerminalExecution(prompt: string): boolean {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ');
  if (EXPLICIT_TERMINAL_EXECUTION_PATTERNS.some((pattern) => pattern.test(normalizedPrompt))) {
    return true;
  }
  return !TERMINAL_COMMAND_REVIEW_PATTERNS.some((pattern) => pattern.test(normalizedPrompt));
}
