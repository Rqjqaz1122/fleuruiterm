import { describe, expect, it, vi } from 'vitest';

import type { TerminalChunk } from '@/domain/session';

import { SessionClient, SessionClientError, type MessageChannel } from './sessionClient';

describe('SessionClient', () => {
  it('configures the output channel before opening a session', async () => {
    const events: string[] = [];
    let outputHandler: ((message: TerminalChunk) => void) | undefined;
    const channel = {
      set onmessage(handler: (message: TerminalChunk) => void) {
        events.push('handler-configured');
        outputHandler = handler;
      },
      get onmessage() {
        return outputHandler ?? (() => undefined);
      },
    } satisfies MessageChannel<TerminalChunk>;
    const invoke = vi.fn(async () => {
      events.push('invoke');
      return {
        sessionId: 'session-a',
        backendType: 'local',
        state: 'ready',
        shell: '/bin/zsh',
      };
    });
    const client = new SessionClient(invoke, () => channel);

    await client.openLocal({ columns: 80, rows: 24 }, vi.fn());

    expect(events).toEqual(['handler-configured', 'invoke']);
    expect(invoke).toHaveBeenCalledWith(
      'session_open_local',
      expect.objectContaining({ onOutput: channel }),
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
