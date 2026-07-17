import { describe, expect, it, vi } from 'vitest';

import {
  TerminalAdapter,
  type FitAddonPort,
  type ResizeObserverPort,
  type TerminalPort,
} from './terminalAdapter';

class FakeTerminal implements TerminalPort {
  cols = 80;
  rows = 24;
  dispose = vi.fn();
  open = vi.fn();
  private readonly writeCallbacks: Array<() => void> = [];
  write = vi.fn((_data: Uint8Array, callback?: () => void) => {
    if (callback !== undefined) {
      this.writeCallbacks.push(callback);
    }
  });
  loadAddon = vi.fn();
  private dataHandler: ((input: string) => void) | null = null;
  readonly dataDisposable = { dispose: vi.fn() };

  onData(handler: (input: string) => void) {
    this.dataHandler = handler;
    return this.dataDisposable;
  }

  emitData(input: string) {
    this.dataHandler?.(input);
  }

  completeWrite() {
    this.writeCallbacks.shift()?.();
  }
}

describe('TerminalAdapter', () => {
  it('forwards terminal input to its session', async () => {
    const terminal = new FakeTerminal();
    const sessionClient = createSessionClient();
    const adapter = createAdapter(terminal, sessionClient);
    adapter.open(document.createElement('div'));

    terminal.emitData('pwd\n');
    await Promise.resolve();

    expect(sessionClient.write).toHaveBeenCalledWith(
      'session-a',
      new TextEncoder().encode('pwd\n'),
    );
  });

  it('writes ordered terminal chunks and rejects a sequence gap', async () => {
    const terminal = new FakeTerminal();
    const onError = vi.fn();
    const adapter = createAdapter(terminal, createSessionClient(), onError);
    adapter.open(document.createElement('div'));

    const firstWrite = adapter.acceptChunk({
      sessionId: 'session-a',
      sequence: 1,
      payload: [97],
    });
    terminal.completeWrite();
    await firstWrite;

    await expect(
      adapter.acceptChunk({ sessionId: 'session-a', sequence: 3, payload: [98] }),
    ).rejects.toMatchObject({ code: 'OUTPUT_SEQUENCE_GAP' });

    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith(new Uint8Array([97]), expect.any(Function));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'OUTPUT_SEQUENCE_GAP' }));
  });

  it('continues from a session sequence captured before remount', () => {
    const terminal = new FakeTerminal();
    const adapter = createAdapter(
      terminal,
      createSessionClient(),
      vi.fn(),
      createResizeObserver(),
      971,
    );
    adapter.open(document.createElement('div'));

    adapter.acceptChunk({ sessionId: 'session-a', sequence: 971, payload: [97] });

    expect(terminal.write).toHaveBeenCalledWith(new Uint8Array([97]), expect.any(Function));
  });

  it('reports output consumed only after the terminal write callback', async () => {
    const terminal = new FakeTerminal();
    const adapter = createAdapter(terminal, createSessionClient());
    adapter.open(document.createElement('div'));
    let consumed = false;

    const consumption = adapter.acceptChunk({
      sessionId: 'session-a',
      sequence: 1,
      payload: [97],
    });
    void consumption.then(() => {
      consumed = true;
    });
    await Promise.resolve();

    expect(consumed).toBe(false);
    terminal.completeWrite();
    await consumption;
    expect(consumed).toBe(true);
  });

  it('sends positive dimensions after fitting its container', async () => {
    const terminal = new FakeTerminal();
    terminal.cols = 120;
    terminal.rows = 40;
    const observer = createResizeObserver();
    const sessionClient = createSessionClient();
    const adapter = createAdapter(terminal, sessionClient, vi.fn(), observer);
    adapter.open(document.createElement('div'));

    observer.trigger();
    await Promise.resolve();

    expect(sessionClient.resize).toHaveBeenCalledWith('session-a', 120, 40);
  });

  it('disposes subscriptions and terminal exactly once', () => {
    const terminal = new FakeTerminal();
    const observer = createResizeObserver();
    const fitAddon = createFitAddon();
    const adapter = new TerminalAdapter({
      sessionId: 'session-a',
      sessionClient: createSessionClient(),
      createTerminal: () => terminal,
      createFitAddon: () => fitAddon,
      createResizeObserver: () => observer,
      onError: vi.fn(),
    });
    adapter.open(document.createElement('div'));

    adapter.dispose();
    adapter.dispose();

    expect(terminal.dataDisposable.dispose).toHaveBeenCalledTimes(1);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(fitAddon.dispose).toHaveBeenCalledTimes(1);
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
  });
});

function createSessionClient() {
  return {
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
  };
}

function createFitAddon(): FitAddonPort {
  return {
    fit: vi.fn(),
    dispose: vi.fn(),
  };
}

function createResizeObserver(): ResizeObserverPort & { trigger: () => void } {
  let callback: (() => void) | null = null;
  return {
    observe: vi.fn(),
    disconnect: vi.fn(),
    setCallback(nextCallback) {
      callback = nextCallback;
    },
    trigger() {
      callback?.();
    },
  };
}

function createAdapter(
  terminal: FakeTerminal,
  sessionClient: ReturnType<typeof createSessionClient>,
  onError = vi.fn(),
  observer = createResizeObserver(),
  initialSequence = 1,
) {
  return new TerminalAdapter({
    sessionId: 'session-a',
    initialSequence,
    sessionClient,
    createTerminal: () => terminal,
    createFitAddon,
    createResizeObserver: (callback) => {
      observer.setCallback(callback);
      return observer;
    },
    onError,
  });
}
