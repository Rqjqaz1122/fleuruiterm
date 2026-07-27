import { invoke } from '@tauri-apps/api/core';

export type SftpEntryKind = 'directory' | 'file' | 'symlink';

export interface SftpDirectoryEntry {
  name: string;
  path: string;
  kind: SftpEntryKind;
  size: number | null;
  modifiedAt: number | null;
  permissions: string | null;
}

export interface SftpOpenResult {
  sftpSessionId: string;
  path: string;
}

export interface SftpDirectoryResult {
  path: string;
  entries: SftpDirectoryEntry[];
}

type Invoke = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;

export class SftpClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SftpClientError';
  }
}

export class SftpClient {
  constructor(private readonly invokeCommand: Invoke = invoke) {}

  async open(terminalSessionId: string): Promise<SftpOpenResult> {
    return this.call('sftp_open', { terminalSessionId }).then(parseOpenResult);
  }

  async listDirectory(sftpSessionId: string, path: string): Promise<SftpDirectoryResult> {
    return this.call('sftp_list_directory', { sftpSessionId, path }).then(parseDirectoryResult);
  }

  async uploadFiles(sftpSessionId: string, remoteDirectory: string): Promise<boolean> {
    return this.call('sftp_upload_files', { sftpSessionId, remoteDirectory }).then(
      parseTransferred,
    );
  }

  async downloadFile(
    sftpSessionId: string,
    remotePath: string,
    suggestedFileName: string,
  ): Promise<boolean> {
    return this.call('sftp_download_file', {
      sftpSessionId,
      remotePath,
      suggestedFileName,
    }).then(parseTransferred);
  }

  async close(sftpSessionId: string): Promise<void> {
    await this.call('sftp_close', { sftpSessionId });
  }

  private async call(command: string, payload: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.invokeCommand(command, payload);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }
}

function parseTransferred(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new SftpClientError('SFTP_INVALID_RESPONSE', 'The SFTP backend returned invalid data');
  }
  return value;
}

function parseOpenResult(value: unknown): SftpOpenResult {
  if (!isRecord(value) || !isNonEmptyString(value.sftpSessionId) || !isAbsolutePath(value.path)) {
    throw new SftpClientError('SFTP_INVALID_RESPONSE', 'The SFTP backend returned invalid data');
  }
  return { sftpSessionId: value.sftpSessionId, path: value.path };
}

function parseDirectoryResult(value: unknown): SftpDirectoryResult {
  if (!isRecord(value) || !isAbsolutePath(value.path) || !Array.isArray(value.entries)) {
    throw new SftpClientError('SFTP_INVALID_RESPONSE', 'The SFTP backend returned invalid data');
  }
  return {
    path: value.path,
    entries: value.entries.map(parseDirectoryEntry),
  };
}

function parseDirectoryEntry(value: unknown): SftpDirectoryEntry {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    !isAbsolutePath(value.path) ||
    !isEntryKind(value.kind) ||
    !isOptionalNumber(value.size) ||
    !isOptionalNumber(value.modifiedAt) ||
    !isOptionalString(value.permissions)
  ) {
    throw new SftpClientError('SFTP_INVALID_RESPONSE', 'The SFTP backend returned invalid data');
  }
  return {
    name: value.name,
    path: value.path,
    kind: value.kind,
    size: value.size,
    modifiedAt: value.modifiedAt,
    permissions: value.permissions,
  };
}

function normalizeClientError(error: unknown): SftpClientError {
  if (error instanceof SftpClientError) {
    return error;
  }
  if (isRecord(error) && isNonEmptyString(error.code) && isNonEmptyString(error.message)) {
    return new SftpClientError(error.code, error.message);
  }
  return new SftpClientError('SFTP_IPC_FAILURE', 'Unable to communicate with FleurTerm backend');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAbsolutePath(value: unknown): value is string {
  return isNonEmptyString(value) && value.startsWith('/');
}

function isEntryKind(value: unknown): value is SftpEntryKind {
  return value === 'directory' || value === 'file' || value === 'symlink';
}

function isOptionalNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
