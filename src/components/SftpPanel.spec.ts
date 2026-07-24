import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import type { OpenableConnectionProfile } from '@/services/connectionProfiles';
import {
  SftpClientError,
  type SftpClient,
  type SftpDirectoryResult,
} from '@/services/sftpClient';
import type { SftpFileDialogs } from '@/services/sftpFileDialogs';

import SftpPanel from './SftpPanel.vue';

describe('SftpPanel', () => {
  it('connects and lists the remote home directory', async () => {
    const client = createClient();
    const wrapper = mount(SftpPanel, { props: { profile: profile(), client } });

    await flushPromises();

    expect(client.open).toHaveBeenCalledOnce();
    expect(client.listDirectory).toHaveBeenCalledWith('sftp-1', '/home/root');
    expect(wrapper.text()).toContain('logs');
    expect(wrapper.text()).toContain('report.txt');
  });

  it('navigates into directories and ignores file rows', async () => {
    const client = createClient();
    const wrapper = mount(SftpPanel, { props: { profile: profile(), client } });
    await flushPromises();

    await wrapper.get('[data-testid="sftp-entry-logs"]').trigger('click');
    await flushPromises();

    expect(client.listDirectory).toHaveBeenLastCalledWith('sftp-1', '/home/root/logs');
  });

  it('uploads selected files and refreshes the directory', async () => {
    const client = createClient();
    const dialogs = createDialogs({ uploadFiles: ['/tmp/local.txt'] });
    const wrapper = mount(SftpPanel, { props: { profile: profile(), client, dialogs } });
    await flushPromises();

    await wrapper.get('[data-testid="sftp-upload"]').trigger('click');
    await flushPromises();

    expect(client.uploadFiles).toHaveBeenCalledWith('sftp-1', '/home/root', ['/tmp/local.txt']);
    expect(client.listDirectory).toHaveBeenCalledTimes(2);
  });

  it('downloads a file to the selected destination', async () => {
    const client = createClient();
    const dialogs = createDialogs({ downloadPath: '/tmp/report.txt' });
    const wrapper = mount(SftpPanel, { props: { profile: profile(), client, dialogs } });
    await flushPromises();

    await wrapper.get('[data-testid="sftp-download-report.txt"]').trigger('click');
    await flushPromises();

    expect(client.downloadFile).toHaveBeenCalledWith(
      'sftp-1',
      '/home/root/report.txt',
      '/tmp/report.txt',
    );
  });

  it('closes the backend session before emitting close', async () => {
    const client = createClient();
    const wrapper = mount(SftpPanel, { props: { profile: profile(), client } });
    await flushPromises();

    await wrapper.get('[data-testid="sftp-close"]').trigger('click');
    await flushPromises();

    expect(client.close).toHaveBeenCalledWith('sftp-1');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('maps structured backend errors to localized messages', async () => {
    const client = createClient();
    vi.mocked(client.open).mockRejectedValue(
      new SftpClientError('SFTP_AUTHENTICATION_FAILED', 'raw backend message'),
    );
    const wrapper = mount(SftpPanel, { props: { profile: profile(), client } });

    await flushPromises();

    expect(wrapper.text()).toContain('Unable to authenticate the SFTP connection');
    expect(wrapper.text()).not.toContain('raw backend message');
  });
});

function createClient(): SftpClient {
  const directory: SftpDirectoryResult = {
    path: '/home/root',
    entries: [
      {
        name: 'logs',
        path: '/home/root/logs',
        kind: 'directory',
        size: null,
        modifiedAt: 1_721_000_000,
        permissions: 'drwxr-xr-x',
      },
      {
        name: 'report.txt',
        path: '/home/root/report.txt',
        kind: 'file',
        size: 128,
        modifiedAt: 1_721_000_000,
        permissions: '-rw-r--r--',
      },
    ],
  };
  return {
    open: vi.fn(async () => ({ sftpSessionId: 'sftp-1', path: '/home/root' })),
    listDirectory: vi.fn(async (_sessionId: string, path: string) => ({ ...directory, path })),
    uploadFiles: vi.fn(async () => undefined),
    downloadFile: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as SftpClient;
}

function createDialogs(
  options: { uploadFiles?: string[]; downloadPath?: string } = {},
): SftpFileDialogs {
  return {
    selectUploadFiles: vi.fn(async () => options.uploadFiles ?? []),
    selectDownloadDestination: vi.fn(async () => options.downloadPath ?? null),
  };
}

function profile(): OpenableConnectionProfile {
  return {
    id: 'server-1',
    name: 'Production',
    method: 'ssh',
    host: '10.7.121.81',
    user: 'root',
    port: 22,
    shell: '',
    cwd: '',
    authMethod: 'agent',
    password: '',
    hasPassword: false,
    privateKeys: [],
    loginScripts: '',
    forwardedPorts: [],
  };
}
