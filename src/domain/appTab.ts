import type { TerminalTab } from '@/domain/workspace';

export const SETTINGS_TAB_ID = 'app-settings';
export const SETTINGS_PANEL_ID = 'settings-panel';

export interface TerminalAppTab {
  id: string;
  kind: 'terminal';
  title: string;
  panelId: string;
}

export interface SettingsAppTab {
  id: typeof SETTINGS_TAB_ID;
  kind: 'settings';
  title: 'Settings';
  panelId: typeof SETTINGS_PANEL_ID;
}

export type AppTab = TerminalAppTab | SettingsAppTab;

export function toTerminalAppTab(tab: TerminalTab): TerminalAppTab {
  return {
    id: tab.id,
    kind: 'terminal',
    title: tab.title,
    panelId: `terminal-panel-${tab.id}`,
  };
}

export function createSettingsAppTab(): SettingsAppTab {
  return {
    id: SETTINGS_TAB_ID,
    kind: 'settings',
    title: 'Settings',
    panelId: SETTINGS_PANEL_ID,
  };
}
