import { invoke } from '@tauri-apps/api/core';

import { SETTINGS_TAB_ID } from '@/domain/appTab';
import type { TerminalLaunch, WorkspaceState } from '@/domain/workspace';

const LEGACY_WORKSPACE_SCHEMA_VERSION = 1;
const WORKSPACE_SCHEMA_VERSION = 2;

export interface PersistedTerminalTab {
  id: string;
  title: string;
  launch: TerminalLaunch;
}

export interface PersistedWorkspace {
  version: typeof WORKSPACE_SCHEMA_VERSION;
  activeTabId: string | null;
  settingsTabIndex: number | null;
  tabs: PersistedTerminalTab[];
}

export interface ApplicationTabPersistenceState {
  activeTabId: string | null;
  settingsTabOpen: boolean;
  tabOrder: readonly string[];
}

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export class WorkspacePersistenceClient {
  constructor(
    private readonly invokeCommand: InvokeCommand = invoke,
    private readonly availabilityCheck: () => boolean = () =>
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  ) {}

  async load(): Promise<PersistedWorkspace | null> {
    if (!this.availabilityCheck()) {
      return null;
    }
    try {
      const workspace = await this.invokeCommand('load_terminal_workspace');
      return parsePersistedWorkspace(workspace);
    } catch {
      return null;
    }
  }

  async save(workspace: PersistedWorkspace): Promise<void> {
    if (!this.availabilityCheck()) {
      return;
    }
    await this.invokeCommand('save_terminal_workspace', { workspace });
  }
}

export function createPersistedWorkspace(
  workspace: WorkspaceState,
  applicationTabs: ApplicationTabPersistenceState = {
    activeTabId: workspace.activeTabId,
    settingsTabOpen: false,
    tabOrder: workspace.tabs.map((tab) => tab.id),
  },
): PersistedWorkspace {
  const applicationTabOrder = normalizeApplicationTabOrder(workspace, applicationTabs);
  const activeTabId = applicationTabOrder.includes(applicationTabs.activeTabId ?? '')
    ? applicationTabs.activeTabId
    : (workspace.activeTabId ?? applicationTabOrder[0] ?? null);
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    activeTabId,
    settingsTabIndex: applicationTabs.settingsTabOpen
      ? applicationTabOrder.indexOf(SETTINGS_TAB_ID)
      : null,
    tabs: workspace.tabs.map(({ id, title, launch }) => ({
      id,
      title,
      launch: cloneTerminalLaunch(launch),
    })),
  };
}

export function parsePersistedWorkspace(value: unknown): PersistedWorkspace | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) {
    return null;
  }

  const tabs: PersistedTerminalTab[] = [];
  const tabIds = new Set<string>();
  for (const candidate of value.tabs) {
    const tab = parsePersistedTerminalTab(candidate);
    if (tab === null || tabIds.has(tab.id)) {
      return null;
    }
    tabIds.add(tab.id);
    tabs.push(tab);
  }

  if (value.version === LEGACY_WORKSPACE_SCHEMA_VERSION) {
    const activeTabId = parseActiveTabId(value.activeTabId, tabIds, false);
    return activeTabId === undefined
      ? null
      : { version: WORKSPACE_SCHEMA_VERSION, activeTabId, settingsTabIndex: null, tabs };
  }
  if (value.version !== WORKSPACE_SCHEMA_VERSION) {
    return null;
  }
  const settingsTabIndex = parseSettingsTabIndex(value.settingsTabIndex, tabs.length);
  if (settingsTabIndex === undefined) {
    return null;
  }
  const activeTabId = parseActiveTabId(value.activeTabId, tabIds, settingsTabIndex !== null);
  return activeTabId === undefined
    ? null
    : { version: WORKSPACE_SCHEMA_VERSION, activeTabId, settingsTabIndex, tabs };
}

function normalizeApplicationTabOrder(
  workspace: WorkspaceState,
  applicationTabs: ApplicationTabPersistenceState,
): string[] {
  const availableTabIds = [
    ...workspace.tabs.map((tab) => tab.id),
    ...(applicationTabs.settingsTabOpen ? [SETTINGS_TAB_ID] : []),
  ];
  const availableTabIdSet = new Set(availableTabIds);
  const normalizedTabOrder: string[] = [];
  for (const tabId of [...applicationTabs.tabOrder, ...availableTabIds]) {
    if (availableTabIdSet.has(tabId) && !normalizedTabOrder.includes(tabId)) {
      normalizedTabOrder.push(tabId);
    }
  }
  return normalizedTabOrder;
}

function parseSettingsTabIndex(value: unknown, terminalTabCount: number): number | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= terminalTabCount
    ? value
    : undefined;
}

function parseActiveTabId(
  value: unknown,
  terminalTabIds: ReadonlySet<string>,
  settingsTabOpen: boolean,
): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  return terminalTabIds.has(value) || (settingsTabOpen && value === SETTINGS_TAB_ID)
    ? value
    : undefined;
}

function parsePersistedTerminalTab(value: unknown): PersistedTerminalTab | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = nonEmptyString(value.id);
  const title = nonEmptyString(value.title);
  const launch = parseTerminalLaunch(value.launch);
  return id === null || title === null || launch === null ? null : { id, title, launch };
}

function parseTerminalLaunch(value: unknown): TerminalLaunch | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === 'savedConnection') {
    const connectionProfileId = nonEmptyString(value.connectionProfileId);
    return connectionProfileId === null ? null : { type: 'savedConnection', connectionProfileId };
  }
  if (value.type !== 'local') {
    return null;
  }

  const shell = optionalString(value, 'shell');
  const cwd = optionalString(value, 'cwd');
  const args = optionalStringArray(value, 'args');
  if (shell === null || cwd === null || args === null) {
    return null;
  }
  return {
    type: 'local',
    ...(shell === undefined ? {} : { shell }),
    ...(args === undefined ? {} : { args }),
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function cloneTerminalLaunch(launch: TerminalLaunch): TerminalLaunch {
  return launch.type === 'savedConnection'
    ? { ...launch }
    : { ...launch, ...(launch.args === undefined ? {} : { args: [...launch.args] }) };
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined | null {
  const field = value[key];
  if (field === undefined || field === null) {
    return undefined;
  }
  return typeof field === 'string' ? field : null;
}

function optionalStringArray(
  value: Record<string, unknown>,
  key: string,
): string[] | undefined | null {
  const field = value[key];
  if (field === undefined || field === null) {
    return undefined;
  }
  return Array.isArray(field) && field.every((item) => typeof item === 'string')
    ? [...field]
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const workspacePersistenceClient = new WorkspacePersistenceClient();
