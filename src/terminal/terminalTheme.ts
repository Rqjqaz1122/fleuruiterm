export const TERMINAL_THEME_CHANGED_EVENT = 'fleurterm:terminal-theme-change';

export type TerminalThemeTone = 'dark' | 'light';

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export function createTerminalTheme(
  styles: CSSStyleDeclaration,
  tone: TerminalThemeTone,
): TerminalTheme {
  const background = readCssVariable(
    styles,
    '--color-terminal',
    tone === 'light' ? '#ffffff' : '#202020',
  );
  const foreground = readCssVariable(
    styles,
    '--theme-terminal-fg',
    tone === 'light' ? '#1f2937' : '#eef3f8',
  );
  const muted = readCssVariable(
    styles,
    '--theme-terminal-muted',
    tone === 'light' ? '#667085' : '#8a98a8',
  );
  const accent = readCssVariable(styles, '--color-accent', '#4fadff');
  const ansi = tone === 'light' ? LIGHT_ANSI_COLORS : DARK_ANSI_COLORS;

  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: 'rgba(79, 173, 255, 0.28)',
    black: ansi.black,
    red: ansi.red,
    green: ansi.green,
    yellow: ansi.yellow,
    blue: ansi.blue,
    magenta: ansi.magenta,
    cyan: ansi.cyan,
    white: foreground,
    brightBlack: muted,
    brightRed: ansi.brightRed,
    brightGreen: ansi.brightGreen,
    brightYellow: ansi.brightYellow,
    brightBlue: ansi.brightBlue,
    brightMagenta: ansi.brightMagenta,
    brightCyan: ansi.brightCyan,
    brightWhite: ansi.brightWhite,
  };
}

function readCssVariable(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

const DARK_ANSI_COLORS = {
  black: '#000000',
  red: '#d9534f',
  green: '#5cb85c',
  yellow: '#f0ad4e',
  blue: '#4fadff',
  magenta: '#b68cff',
  cyan: '#5bc0de',
  brightRed: '#ff6b66',
  brightGreen: '#7bd87b',
  brightYellow: '#ffd166',
  brightBlue: '#78c3ff',
  brightMagenta: '#d0a3ff',
  brightCyan: '#7de3f3',
  brightWhite: '#ffffff',
} as const;

const LIGHT_ANSI_COLORS = {
  black: '#1f2937',
  red: '#b42318',
  green: '#067647',
  yellow: '#b54708',
  blue: '#175cd3',
  magenta: '#9333a8',
  cyan: '#0e7490',
  brightRed: '#d92d20',
  brightGreen: '#079455',
  brightYellow: '#dc6803',
  brightBlue: '#1570ef',
  brightMagenta: '#a855f7',
  brightCyan: '#0891b2',
  brightWhite: '#111827',
} as const;
