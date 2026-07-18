import { describe, expect, it, vi } from 'vitest';

import type { SessionStateChanged, TerminalChunk } from '@/domain/session';

import { SessionClient, SessionClientError, type MessageChannel } from './sessionClient';

describe('SessionClient', () => {
  it('configures the output channel before opening a session', async () => {
    const events: string[] = [];
    const outputChannel = createRecordingChannel<TerminalChunk>(events);
    const stateChannel = createRecordingChannel<SessionStateChanged>(events);
    const channels: MessageChannel<unknown>[] = [outputChannel, stateChannel];
    const invoke = vi.fn(async () => {
      events.push('invoke');
      return {
        sessionId: 'session-a',
        backendType: 'local',
        state: 'ready',
        shell: '/bin/zsh',
      };
    });
    const client = new SessionClient(invoke, () => {
      const channel = channels.shift();
      if (channel === undefined) {
        throw new Error('test channel factory exhausted');
      }
      return channel;
    });

    await client.openLocal({ columns: 80, rows: 24 }, vi.fn());

    expect(events).toEqual(['handler-configured', 'handler-configured', 'invoke']);
    expect(invoke).toHaveBeenCalledWith(
      'session_open_local',
      expect.objectContaining({ onOutput: outputChannel, onState: stateChannel }),
    );
  });

  it('writes terminal bytes through the named command', async () => {
    const invoke = vi.fn(async () => undefined);
    const client = new SessionClient(invoke, () => ({ onmessage: () => undefined }));

    await client.write('session-a', new Uint8Array([108, 115, 10]));

    expect(invoke).toHaveBeenCalledWith('session_write', {
      sessionId: 'session-a',
      input: [108, 115, 10],
    });
  });

  it('passes shell arguments and working directory when opening a session', async () => {
    const outputChannel = { onmessage: () => undefined };
    const stateChannel = { onmessage: () => undefined };
    const channels: MessageChannel<unknown>[] = [outputChannel, stateChannel];
    const invoke = vi.fn(async () => ({
      sessionId: 'session-a',
      backendType: 'local',
      state: 'ready',
      shell: '/bin/zsh',
    }));
    const client = new SessionClient(invoke, () => {
      const channel = channels.shift();
      if (channel === undefined) {
        throw new Error('test channel factory exhausted');
      }
      return channel;
    });

    await client.openLocal(
      { shell: 'bash', args: ['-lc', 'pwd'], cwd: '/tmp/project', columns: 80, rows: 24 },
      vi.fn(),
    );

    expect(invoke).toHaveBeenCalledWith(
      'session_open_local',
      expect.objectContaining({
        request: {
          shell: 'bash',
          args: ['-lc', 'pwd'],
          cwd: '/tmp/project',
          columns: 80,
          rows: 24,
        },
      }),
    );
  });

  it('acknowledges each delivered terminal output sequence', async () => {
    const outputChannel = { onmessage: () => undefined };
    const stateChannel = { onmessage: () => undefined };
    const channels: MessageChannel<unknown>[] = [outputChannel, stateChannel];
    const invoke = vi.fn(async (command: string) =>
      command === 'session_open_local'
        ? {
            sessionId: 'session-a',
            backendType: 'local',
            state: 'ready',
            shell: '/bin/zsh',
          }
        : undefined,
    );
    const client = new SessionClient(invoke, () => {
      const channel = channels.shift();
      if (channel === undefined) {
        throw new Error('test channel factory exhausted');
      }
      return channel;
    });
    await client.openLocal({ columns: 80, rows: 24 }, vi.fn());

    await outputChannel.onmessage({ sessionId: 'session-a', sequence: 7, payload: [97] });

    expect(invoke).toHaveBeenCalledWith('session_ack_output', {
      sessionId: 'session-a',
      sequence: 7,
    });
  });

  it('waits for terminal consumption before acknowledging output', async () => {
    const outputChannel = { onmessage: () => undefined };
    const stateChannel = { onmessage: () => undefined };
    const channels: MessageChannel<unknown>[] = [outputChannel, stateChannel];
    const invoke = vi.fn(async (command: string) =>
      command === 'session_open_local'
        ? {
            sessionId: 'session-a',
            backendType: 'local',
            state: 'ready',
            shell: '/bin/zsh',
          }
        : undefined,
    );
    let finishConsumption: (() => void) | undefined;
    const onOutput = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishConsumption = resolve;
        }),
    );
    const client = new SessionClient(invoke, () => {
      const channel = channels.shift();
      if (channel === undefined) {
        throw new Error('test channel factory exhausted');
      }
      return channel;
    });
    await client.openLocal({ columns: 80, rows: 24 }, onOutput);

    const delivery = outputChannel.onmessage({
      sessionId: 'session-a',
      sequence: 8,
      payload: [98],
    });
    await Promise.resolve();

    expect(invoke).not.toHaveBeenCalledWith('session_ack_output', expect.anything());
    finishConsumption?.();
    await delivery;
    expect(invoke).toHaveBeenCalledWith('session_ack_output', {
      sessionId: 'session-a',
      sequence: 8,
    });
  });

  it('forwards lifecycle changes through the state channel', async () => {
    const outputChannel = { onmessage: () => undefined };
    const stateChannel = { onmessage: () => undefined };
    const channels: MessageChannel<unknown>[] = [outputChannel, stateChannel];
    const invoke = vi.fn(async () => ({
      sessionId: 'session-a',
      backendType: 'local',
      state: 'ready',
      shell: '/bin/zsh',
    }));
    const client = new SessionClient(invoke, () => {
      const channel = channels.shift();
      if (channel === undefined) {
        throw new Error('test channel factory exhausted');
      }
      return channel;
    });
    const onState = vi.fn();
    await client.openLocal({ columns: 80, rows: 24 }, vi.fn(), onState);

    stateChannel.onmessage({ sessionId: 'session-a', state: 'closed' });

    expect(onState).toHaveBeenCalledWith({ sessionId: 'session-a', state: 'closed' });
  });

  it('rejects oversized input before invoke', async () => {
    const invoke = vi.fn(async () => undefined);
    const client = new SessionClient(invoke, () => ({ onmessage: () => undefined }));

    await expect(client.write('session-a', new Uint8Array(65_537))).rejects.toMatchObject({
      code: 'INPUT_TOO_LARGE',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('maps unknown invoke failures to a stable client error', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('bridge unavailable');
    });
    const client = new SessionClient(invoke, () => ({ onmessage: () => undefined }));

    const result = client.close('session-a');

    await expect(result).rejects.toEqual(
      new SessionClientError('IPC_FAILURE', 'Unable to communicate with FleurTerm backend'),
    );
  });
});

function createRecordingChannel<T>(events: string[]): MessageChannel<T> {
  let messageHandler: (message: T) => void = () => undefined;
  return {
    set onmessage(handler: (message: T) => void) {
      events.push('handler-configured');
      messageHandler = handler;
    },
    get onmessage() {
      return messageHandler;
    },
  };
}
