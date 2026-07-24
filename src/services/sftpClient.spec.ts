import { describe, expect, it, vi } from 'vitest';

import type { OpenableConnectionProfile } from './connectionProfiles';
import { SftpClient, SftpClientError } from './sftpClient';

describe('SftpClient', () => {
  it('opens SFTP without sending the saved password', async () => {
    const invoke = vi.fn(async () => ({ sftpSessionId: 'sftp-1', path: '/home/root' }));
    const client = new SftpClient(invoke);

    await client.open(profile());

    expect(invoke).toHaveBeenCalledWith('sftp_open', {
      request: {
        connectionId: 'server-1',
        host: '10.7.121.81',
        port: 22,
        user: 'root',
        authMethod: 'agent',
        privateKeyPaths: [],
      },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('secret');
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

    await expect(client.open(profile())).rejects.toEqual(
      new SftpClientError('SFTP_AUTHENTICATION_FAILED', 'Unable to authenticate'),
    );
  });

  it('delegates upload download and close commands', async () => {
    const invoke = vi.fn(async () => undefined);
    const client = new SftpClient(invoke);

    await client.uploadFiles('sftp-1', '/tmp', ['/Users/me/report.txt']);
    await client.downloadFile('sftp-1', '/tmp/report.txt', '/Users/me/report.txt');
    await client.close('sftp-1');

    expect(invoke.mock.calls).toEqual([
      [
        'sftp_upload_files',
        {
          sftpSessionId: 'sftp-1',
          remoteDirectory: '/tmp',
          localPaths: ['/Users/me/report.txt'],
        },
      ],
      [
        'sftp_download_file',
        {
          sftpSessionId: 'sftp-1',
          remotePath: '/tmp/report.txt',
          localPath: '/Users/me/report.txt',
        },
      ],
      ['sftp_close', { sftpSessionId: 'sftp-1' }],
    ]);
  });
});

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
    password: 'secret',
    hasPassword: true,
    privateKeys: [],
    loginScripts: '',
    forwardedPorts: [],
  };
}
