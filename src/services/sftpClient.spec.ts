import { describe, expect, it, vi } from 'vitest';

import { SftpClient, SftpClientError } from './sftpClient';

describe('SftpClient', () => {
  it('opens SFTP using only the active terminal capability', async () => {
    const invoke = vi.fn(async () => ({ sftpSessionId: 'sftp-1', path: '/home/root' }));
    const client = new SftpClient(invoke);

    await client.open('terminal-1');

    expect(invoke).toHaveBeenCalledWith('sftp_open', {
      terminalSessionId: 'terminal-1',
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/host|user|password|privateKey/i);
  });

  it('lists a directory through the named SFTP session', async () => {
    const invoke = vi.fn(async () => ({
      path: '/tmp',
      entries: [
        {
          name: 'logs',
          path: '/tmp/logs',
          kind: 'directory',
          size: null,
          modifiedAt: 1_721_000_000,
          permissions: 'drwxr-xr-x',
        },
      ],
    }));
    const client = new SftpClient(invoke);

    const result = await client.listDirectory('sftp-1', '/tmp');

    expect(result.entries[0]?.name).toBe('logs');
    expect(invoke).toHaveBeenCalledWith('sftp_list_directory', {
      sftpSessionId: 'sftp-1',
      path: '/tmp',
    });
  });

  it('maps structured backend failures', async () => {
    const invoke = vi.fn(async () => {
      throw { code: 'SFTP_AUTHENTICATION_FAILED', message: 'Unable to authenticate' };
    });
    const client = new SftpClient(invoke);

    await expect(client.open('terminal-1')).rejects.toEqual(
      new SftpClientError('SFTP_AUTHENTICATION_FAILED', 'Unable to authenticate'),
    );
  });

  it('delegates native-dialog transfers without exposing local paths', async () => {
    const invoke = vi.fn(async (command: string) => command !== 'sftp_download_file');
    const client = new SftpClient(invoke);

    await expect(client.uploadFiles('sftp-1', '/tmp', 'zh-CN')).resolves.toBe(true);
    await expect(
      client.downloadFile('sftp-1', '/tmp/report.txt', 'report.txt', 'zh-CN'),
    ).resolves.toBe(false);
    await client.close('sftp-1');

    expect(invoke.mock.calls).toEqual([
      [
        'sftp_upload_files',
        {
          sftpSessionId: 'sftp-1',
          remoteDirectory: '/tmp',
          locale: 'zh-CN',
        },
      ],
      [
        'sftp_download_file',
        {
          sftpSessionId: 'sftp-1',
          remotePath: '/tmp/report.txt',
          suggestedFileName: 'report.txt',
          locale: 'zh-CN',
        },
      ],
      ['sftp_close', { sftpSessionId: 'sftp-1' }],
    ]);
  });

  it('deletes a remote entry through the named SFTP session', async () => {
    const invoke = vi.fn(async () => undefined);
    const client = new SftpClient(invoke);

    await client.deleteEntry('sftp-1', '/tmp/archive');

    expect(invoke).toHaveBeenCalledWith('sftp_delete_entry', {
      sftpSessionId: 'sftp-1',
      remotePath: '/tmp/archive',
    });
  });
});
