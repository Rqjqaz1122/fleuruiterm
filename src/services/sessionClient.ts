import { Channel, invoke } from '@tauri-apps/api/core';

import type { SessionSnapshot, SessionStateChanged, TerminalChunk } from '@/domain/session';

const MAX_INPUT_BYTES = 64 * 1024;

const SESSION_COMMANDS = {
  openLocal: 'session_open_local',
  acknowledgeOutput: 'session_ack_output',
  write: 'session_write',
  resize: 'session_resize',
  interrupt: 'session_interrupt',
  close: 'session_close',
} as const;

export interface MessageChannel<T> {
  onmessage: (message: T) => void | Promise<void>;
}

export interface OpenLocalSessionOptions {
  shell?: string;
  args?: string[];
  cwd?: string;
  connectionProfileId?: string;
  columns: number;
  rows: number;
}

interface PublicBackendError {
  code: string;
  message: string;
}

type InvokeFunction = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type ChannelFactory = () => MessageChannel<unknown>;

export class SessionClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SessionClientError';
  }
}

export class SessionClient {
  constructor(
    private readonly invokeCommand: InvokeFunction = (command, args) => invoke(command, args),
    private readonly createChannel: ChannelFactory = () => new Channel<unknown>(),
  ) {}

  async openLocal(
    options: OpenLocalSessionOptions,
    onOutput: (chunk: TerminalChunk) => void | Promise<void>,
    onState: (event: SessionStateChanged) => void = () => undefined,
  ): Promise<SessionSnapshot> {
    const outputChannel = this.createChannel() as MessageChannel<TerminalChunk>;
    let outputDelivery = Promise.resolve();
    outputChannel.onmessage = (chunk) => {
      outputDelivery = outputDelivery
        .then(() => onOutput(chunk))
        .then(() =>
          this.invokeSafely(SESSION_COMMANDS.acknowledgeOutput, {
            sessionId: chunk.sessionId,
            sequence: chunk.sequence,
          }),
        )
        .then(() => undefined)
        .catch(() => {
          console.error('Failed to consume terminal output');
        });
      return outputDelivery;
    };
    const stateChannel = this.createChannel() as MessageChannel<SessionStateChanged>;
    stateChannel.onmessage = onState;
    const result = await this.invokeSafely(SESSION_COMMANDS.openLocal, {
      request: {
        shell: options.shell,
        args: options.args ?? [],
        cwd: options.cwd,
        connectionProfileId: options.connectionProfileId,
        columns: options.columns,
        rows: options.rows,
      },
      onOutput: outputChannel,
      onState: stateChannel,
    });
    return result as SessionSnapshot;
  }

  async write(sessionId: string, input: Uint8Array): Promise<void> {
    if (input.byteLength > MAX_INPUT_BYTES) {
      throw new SessionClientError(
        'INPUT_TOO_LARGE',
        `Terminal input cannot exceed ${MAX_INPUT_BYTES} bytes`,
      );
    }
    await this.invokeSafely(SESSION_COMMANDS.write, {
      sessionId,
      input: Array.from(input),
    });
  }

  async resize(sessionId: string, columns: number, rows: number): Promise<void> {
    await this.invokeSafely(SESSION_COMMANDS.resize, { sessionId, columns, rows });
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.invokeSafely(SESSION_COMMANDS.interrupt, { sessionId });
  }

  async close(sessionId: string): Promise<void> {
    await this.invokeSafely(SESSION_COMMANDS.close, { sessionId });
  }

  private async invokeSafely(command: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.invokeCommand(command, args);
    } catch (error) {
      if (isPublicBackendError(error)) {
        throw new SessionClientError(error.code, error.message);
      }
      throw new SessionClientError('IPC_FAILURE', 'Unable to communicate with FleurTerm backend');
    }
  }
}

function isPublicBackendError(value: unknown): value is PublicBackendError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<PublicBackendError>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}
