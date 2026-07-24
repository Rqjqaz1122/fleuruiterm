import { describe, expect, it, vi } from 'vitest';

import { createWorkspace } from '@/domain/workspace';

import {
  WorkspacePersistenceClient,
  createPersistedWorkspace,
  parsePersistedWorkspace,
  type PersistedWorkspace,
} from './workspacePersistence';

const persistedWorkspace: PersistedWorkspace = {
  version: 1,
  activeTabId: 'tab-2',
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
      version: 1,
      activeTabId: 'tab-1',
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

  it('parses restorable terminal tabs without runtime session state', () => {
    expect(parsePersistedWorkspace(persistedWorkspace)).toEqual(persistedWorkspace);
  });

  it('rejects malformed workspace data instead of partially trusting it', () => {
    expect(
      parsePersistedWorkspace({
        ...persistedWorkspace,
        tabs: [{ id: 'tab-1', title: 'Unsafe', launch: { type: 'local', args: ['ssh', 42] } }],
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
