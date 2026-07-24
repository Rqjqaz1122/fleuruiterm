import { open, save } from '@tauri-apps/plugin-dialog';

export interface SftpFileDialogRuntime {
  open(options: { multiple: true; directory: false }): Promise<string | string[] | null>;
  save(options: { defaultPath: string }): Promise<string | null>;
}

export interface SftpFileDialogs {
  selectUploadFiles(): Promise<string[]>;
  selectDownloadDestination(fileName: string): Promise<string | null>;
}

export function createSftpFileDialogs(
  runtime: SftpFileDialogRuntime = { open, save },
): SftpFileDialogs {
  return {
    async selectUploadFiles(): Promise<string[]> {
      const selected = await runtime.open({ multiple: true, directory: false });
      if (selected === null) {
        return [];
      }
      return Array.isArray(selected) ? selected : [selected];
    },

    selectDownloadDestination(fileName: string): Promise<string | null> {
      return runtime.save({ defaultPath: fileName });
    },
  };
}

export const sftpFileDialogs = createSftpFileDialogs();
