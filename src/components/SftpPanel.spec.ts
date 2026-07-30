import { readFileSync } from 'node:fs';

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { SftpClientError, type SftpClient, type SftpDirectoryResult } from '@/services/sftpClient';

import SftpPanel from './SftpPanel.vue';

const globalStyles = readFileSync('src/styles/global.css', 'utf8');

describe('SftpPanel', () => {
  it('prevents selecting labels and glyphs inside action buttons', () => {
    const buttonRule = /(?:^|\n)button\s*\{([^}]*)\}/.exec(globalStyles)?.[1];

    expect(buttonRule).toBeDefined();
    expect(buttonRule).toContain('-webkit-user-select: none');
    expect(buttonRule).toContain('user-select: none');
  });

  it('connects and lists the remote home directory', async () => {
    const client = createClient();
    const wrapper = mount(SftpPanel, { props: { terminalSessionId: 'terminal-1', client } });

    await flushPromises();

    expect(client.open).toHaveBeenCalledOnce();
    expect(client.listDirectory).toHaveBeenCalledWith('sftp-1', '/home/root');
    expect(wrapper.text()).toContain('logs');
    expect(wrapper.text()).toContain('report.txt');
  });

  it('navigates into directories and ignores file rows', async () => {
    const client = createClient();
    const wrapper = mount(SftpPanel, { props: { terminalSessionId: 'terminal-1', client } });
    await flushPromises();

    await wrapper.get('[data-testid="sftp-entry-logs"]').trigger('click');
    await flushPromises();

    expect(client.listDirectory).toHaveBeenLastCalledWith('sftp-1', '/home/root/logs');
  });

  it('uploads selected files and refreshes the directory', async () => {
    const client = createClient();
    const wrapper = mount(SftpPanel, { props: { terminalSessionId: 'terminal-1', client } });
    await flushPromises();

    await wrapper.get('[data-testid="sftp-upload"]').trigger('click');
    await flushPromises();

    expect(client.uploadFiles).toHaveBeenCalledWith('sftp-1', '/home/root');
    expect(client.listDirectory).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate upload operations while native selection is pending', async () => {
    const client = createClient();
    let finishSelection: ((transferred: boolean) => void) | null = null;
    vi.mocked(client.uploadFiles).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishSelection = resolve;
        }),
    );
    const wrapper = mount(SftpPanel, { props: { terminalSessionId: 'terminal-1', client } });
    await flushPromises();

    const uploadButton = wrapper.get('[data-testid="sftp-upload"]');
    await uploadButton.trigger('click');
    await uploadButton.trigger('click');

    expect(client.uploadFiles).toHaveBeenCalledOnce();
    finishSelection?.(false);
    await flushPromises();
  });

  it('downloads a file to the selected destination', async () => {
    const client = createClient();
    const wrapper = mount(SftpPanel, { props: { terminalSessionId: 'terminal-1', client } });
    await flushPromises();

    await wrapper.get('[data-testid="sftp-download-report.txt"]').trigger('click');
    await flushPromises();

    expect(client.downloadFile).toHaveBeenCalledWith(
      'sftp-1',
      '/home/root/report.txt',
      'report.txt',
    );
  });

  it('prevents duplicate downloads while native selection is pending', async () => {
    const client = createClient();
    let finishSelection: ((transferred: boolean) => void) | null = null;
    vi.mocked(client.downloadFile).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishSelection = resolve;
        }),
    );
    const wrapper = mount(SftpPanel, { props: { terminalSessionId: 'terminal-1', client } });
    await flushPromises();

    const downloadButton = wrapper.get('[data-testid="sftp-download-report.txt"]');
    await downloadButton.trigger('click');
    await downloadButton.trigger('click');

    expect(client.downloadFile).toHaveBeenCalledOnce();
    finishSelection?.(false);
    await flushPromises();
  });

  it('closes the backend session before emitting close', async () => {
    const client = createClient();
    const wrapper = mount(SftpPanel, { props: { terminalSessionId: 'terminal-1', client } });
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
    const wrapper = mount(SftpPanel, { props: { terminalSessionId: 'terminal-1', client } });

    await flushPromises();

    expect(wrapper.text()).toContain('Unable to authenticate the SFTP connection');
    expect(wrapper.text()).not.toContain('raw backend message');
  });

  it('renders without a resize handle', async () => {
    const wrapper = mount(SftpPanel, {
      props: { terminalSessionId: 'terminal-1', client: createClient() },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="sftp-resize-handle"]').exists()).toBe(false);
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
    uploadFiles: vi.fn(async () => true),
    downloadFile: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  } as unknown as SftpClient;
}
