import { invoke } from '@tauri-apps/api/core';

import type { TerminalLaunch, WorkspaceState } from '@/domain/workspace';

const WORKSPACE_SCHEMA_VERSION = 1;

export interface PersistedTerminalTab {
  id: string;
  title: string;
  launch: TerminalLaunch;
}

export interface PersistedWorkspace {
  version: typeof WORKSPACE_SCHEMA_VERSION;
  activeTabId: string | null;
  tabs: PersistedTerminalTab[];
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

export function createPersistedWorkspace(workspace: WorkspaceState): PersistedWorkspace {
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    activeTabId: workspace.activeTabId,
    tabs: workspace.tabs.map(({ id, title, launch }) => ({
      id,
      title,
      launch: cloneTerminalLaunch(launch),
    })),
  };
}

export function parsePersistedWorkspace(value: unknown): PersistedWorkspace | null {
  if (
    !isRecord(value) ||
    value.version !== WORKSPACE_SCHEMA_VERSION ||
    !Array.isArray(value.tabs)
  ) {
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

  const activeTabId = value.activeTabId;
  if (activeTabId !== null && (typeof activeTabId !== 'string' || !tabIds.has(activeTabId))) {
    return null;
  }
  return { version: WORKSPACE_SCHEMA_VERSION, activeTabId, tabs };
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
  return field === undefined || typeof field === 'string' ? field : null;
}

function optionalStringArray(
  value: Record<string, unknown>,
  key: string,
): string[] | undefined | null {
  const field = value[key];
  if (field === undefined) {
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
