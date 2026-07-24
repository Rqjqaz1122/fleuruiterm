import { describe, expect, it, vi } from 'vitest';

import { createSftpFileDialogs } from './sftpFileDialogs';

describe('sftpFileDialogs', () => {
  it('normalizes a single upload selection', async () => {
    const dialogs = createSftpFileDialogs({
      open: vi.fn(async () => '/tmp/report.txt'),
      save: vi.fn(async () => null),
    });
    await expect(dialogs.selectUploadFiles()).resolves.toEqual(['/tmp/report.txt']);
  });

  it('returns no files when upload selection is cancelled', async () => {
    const dialogs = createSftpFileDialogs({
      open: vi.fn(async () => null),
      save: vi.fn(async () => null),
    });
    await expect(dialogs.selectUploadFiles()).resolves.toEqual([]);
  });

  it('uses the remote file name as the default download path', async () => {
    const save = vi.fn(async () => '/tmp/report.txt');
    const dialogs = createSftpFileDialogs({ open: vi.fn(async () => null), save });
    await expect(dialogs.selectDownloadDestination('report.txt')).resolves.toBe('/tmp/report.txt');
    expect(save).toHaveBeenCalledWith({ defaultPath: 'report.txt' });
  });
});
