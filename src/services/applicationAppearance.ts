import { settingsClient } from '@/services/settingsClient';
import type { AppearanceSettings, ThemeTone } from '@/stores/appSettingsStore';
import { TERMINAL_THEME_CHANGED_EVENT } from '@/terminal/terminalTheme';

export function applyApplicationAppearance(settings: AppearanceSettings): void {
  if (typeof document === 'undefined') {
    return;
  }
  const resolvedTone = resolveThemeTone(settings.themeMode);
  const colors = interfaceColors(resolvedTone);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--color-canvas', colors.canvas);
  rootStyle.setProperty('--color-surface', colors.surface);
  rootStyle.setProperty('--color-surface-raised', colors.raised);
  rootStyle.setProperty('--color-surface-hover', colors.hover);
  rootStyle.setProperty('--color-terminal', colors.terminal);
  rootStyle.setProperty('--color-border', colors.border);
  rootStyle.setProperty('--color-border-strong', colors.strongBorder);
  rootStyle.setProperty('--color-text', colors.text);
  rootStyle.setProperty('--color-text-muted', colors.muted);
  rootStyle.setProperty('--color-surface-card', colors.card);
  rootStyle.setProperty('--color-surface-card-soft', colors.cardSoft);
  rootStyle.setProperty('--theme-fg-less', colors.less);
  rootStyle.setProperty('--theme-fg-subtle', colors.subtle);
  rootStyle.setProperty('--terminal-bg', colors.terminal);
  rootStyle.setProperty('--app-layer-blur', `${settings.transparency.blur}px`);
  rootStyle.setProperty('--app-overlay-blur', `${Math.max(8, settings.transparency.blur)}px`);
  const activeTerminalPalette = settings.palettes[resolvedTone];
  rootStyle.setProperty('--theme-terminal-fg', activeTerminalPalette.terminalForeground);
  rootStyle.setProperty('--theme-terminal-muted', activeTerminalPalette.terminalMuted);
  document.documentElement.dataset.themeMode = settings.themeMode;
  document.documentElement.dataset.themeTone = resolvedTone;
  const opacity = settings.transparency.enabled ? settings.transparency.opacity / 100 : 1;
  void settingsClient.setWindowOpacity(opacity).catch(() => undefined);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(TERMINAL_THEME_CHANGED_EVENT));
  }
}

function resolveThemeTone(themeMode: AppearanceSettings['themeMode']): ThemeTone {
  const prefersLight =
    themeMode === 'system' &&
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  return themeMode === 'light' || prefersLight ? 'light' : 'dark';
}

function interfaceColors(tone: ThemeTone) {
  return tone === 'light'
    ? {
        canvas: '#f4f6f8',
        surface: '#ffffff',
        raised: '#edf1f5',
        hover: 'rgb(20 34 48 / 9%)',
        terminal: '#ffffff',
        border: 'rgb(20 34 48 / 12%)',
        strongBorder: 'rgb(20 34 48 / 22%)',
        text: '#17202a',
        muted: 'rgb(23 32 42 / 58%)',
        subtle: 'rgb(23 32 42 / 42%)',
        less: '#2d3a46',
        card: 'rgb(20 34 48 / 5%)',
        cardSoft: 'rgb(20 34 48 / 3.5%)',
      }
    : {
        canvas: '#000000',
        surface: '#111111',
        raised: '#202020',
        hover: 'rgb(144 144 144 / 32%)',
        terminal: '#202020',
        border: 'rgb(255 255 255 / 9%)',
        strongBorder: 'rgb(255 255 255 / 15%)',
        text: '#f1f1f1',
        muted: 'rgb(255 255 255 / 56%)',
        subtle: 'rgb(255 255 255 / 42%)',
        less: '#dddddd',
        card: '#1c1c1c',
        cardSoft: '#181818',
      };
}
