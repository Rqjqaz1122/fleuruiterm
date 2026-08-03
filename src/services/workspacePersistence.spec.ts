import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_TAB_ID } from '@/domain/appTab';
import { createWorkspace } from '@/domain/workspace';

import {
  WorkspacePersistenceClient,
  createPersistedWorkspace,
  parsePersistedWorkspace,
  type PersistedWorkspace,
} from './workspacePersistence';

const persistedWorkspace: PersistedWorkspace = {
  version: 2,
  activeTabId: 'tab-2',
  settingsTabIndex: null,
  tabs: [
    {
      id: 'tab-1',
      title: 'Local',
      launch: { type: 'local', shell: '/bin/zsh', cwd: '/tmp/project' },
    },
    {
      id: 'tab-2',
      title: 'Production',
      launch: { type: 'savedConnection', connectionProfileId: 'production' },
    },
  ],
};

const legacyPersistedWorkspace = {
  version: 1,
  activeTabId: persistedWorkspace.activeTabId,
  tabs: persistedWorkspace.tabs,
};

describe('workspace persistence', () => {
  it('serializes launch metadata without runtime session identifiers', () => {
    const workspace = createWorkspace(
      'runtime-session',
      sequenceIds('tab-1', 'pane-1'),
      'Production',
      { type: 'savedConnection', connectionProfileId: 'production' },
    );

    const serialized = createPersistedWorkspace(workspace);

    expect(serialized).toEqual({
      version: 2,
      activeTabId: 'tab-1',
      settingsTabIndex: null,
      tabs: [
        {
          id: 'tab-1',
          title: 'Production',
          launch: { type: 'savedConnection', connectionProfileId: 'production' },
        },
      ],
    });
    expect(JSON.stringify(serialized)).not.toContain('runtime-session');
  });

  it('serializes the settings tab position and active application tab', () => {
    const workspace = createWorkspace(
      'runtime-session',
      sequenceIds('tab-1', 'pane-1'),
      'Local',
    );

    const serialized = createPersistedWorkspace(workspace, {
      activeTabId: SETTINGS_TAB_ID,
      settingsTabOpen: true,
      tabOrder: ['tab-1', SETTINGS_TAB_ID],
    });

    expect(serialized).toEqual({
      version: 2,
      activeTabId: SETTINGS_TAB_ID,
      settingsTabIndex: 1,
      tabs: [{ id: 'tab-1', title: 'Local', launch: { type: 'local' } }],
    });
  });

  it('parses restorable terminal tabs without runtime session state', () => {
    expect(parsePersistedWorkspace(persistedWorkspace)).toEqual(persistedWorkspace);
  });

  it('recovers local launch metadata serialized with null optional fields', () => {
    expect(
      parsePersistedWorkspace({
        version: 1,
        activeTabId: 'local-tab',
        tabs: [
          {
            id: 'local-tab',
            title: 'Local',
            launch: { type: 'local', shell: null, args: null, cwd: null },
          },
        ],
      }),
    ).toEqual({
      version: 2,
      activeTabId: 'local-tab',
      settingsTabIndex: null,
      tabs: [{ id: 'local-tab', title: 'Local', launch: { type: 'local' } }],
    });
  });

  it('migrates version one terminal workspaces with settings closed', () => {
    expect(parsePersistedWorkspace(legacyPersistedWorkspace)).toEqual({
      ...legacyPersistedWorkspace,
      version: 2,
      settingsTabIndex: null,
    });
  });

  it('parses a version two workspace with settings active', () => {
    const versionTwoWorkspace = {
      version: 2,
      activeTabId: SETTINGS_TAB_ID,
      settingsTabIndex: 1,
      tabs: [
        {
          id: 'local-tab',
          title: 'Local',
          launch: { type: 'local' },
        },
      ],
    };

    expect(parsePersistedWorkspace(versionTwoWorkspace)).toEqual(versionTwoWorkspace);
  });

  it('treats an omitted version two settings index as a closed settings tab', () => {
    expect(
      parsePersistedWorkspace({
        version: 2,
        activeTabId: 'local-tab',
        tabs: [
          {
            id: 'local-tab',
            title: 'Local',
            launch: { type: 'local' },
          },
        ],
      }),
    ).toEqual({
      version: 2,
      activeTabId: 'local-tab',
      settingsTabIndex: null,
      tabs: [{ id: 'local-tab', title: 'Local', launch: { type: 'local' } }],
    });
  });

  it('rejects settings as active when the settings tab is closed', () => {
    expect(
      parsePersistedWorkspace({
        version: 2,
        activeTabId: SETTINGS_TAB_ID,
        settingsTabIndex: null,
        tabs: [],
      }),
    ).toBeNull();
  });

  it('rejects malformed workspace data instead of partially trusting it', () => {
    expect(
      parsePersistedWorkspace({
        ...persistedWorkspace,
        tabs: [{ id: 'tab-1', title: 'Unsafe', launch: { type: 'local', args: ['ssh', 42] } }],
      }),
    ).toBeNull();
  });

  it('rejects an abnormally large persisted terminal workspace', () => {
    expect(
      parsePersistedWorkspace({
        version: 2,
        activeTabId: 'tab-1',
        settingsTabIndex: null,
        tabs: Array.from({ length: 33 }, (_, index) => ({
          id: `tab-${index + 1}`,
          title: `Local Terminal ${index + 1}`,
          launch: { type: 'local' },
        })),
      }),
    ).toBeNull();
  });

  it('loads and validates workspace.json through the Tauri command', async () => {
    const invoke = vi.fn(async () => persistedWorkspace);
    const client = new WorkspacePersistenceClient(invoke, () => true);

    await expect(client.load()).resolves.toEqual(persistedWorkspace);
    expect(invoke).toHaveBeenCalledWith('load_terminal_workspace');
  });

  it('saves only the supplied persistent workspace snapshot', async () => {
    const invoke = vi.fn(async () => undefined);
    const client = new WorkspacePersistenceClient(invoke, () => true);

    await client.save(persistedWorkspace);

    expect(invoke).toHaveBeenCalledWith('save_terminal_workspace', {
      workspace: persistedWorkspace,
    });
  });
});

function sequenceIds(...values: string[]) {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error('test ID generator exhausted');
    }
    index += 1;
    return value;
  };
}
