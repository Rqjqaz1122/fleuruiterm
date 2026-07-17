import { describe, expect, it, vi } from 'vitest';

import {
  TerminalAdapter,
  type AnimationFrameScheduler,
  type FitAddonPort,
  type ResizeObserverPort,
  type TerminalPort,
} from './terminalAdapter';

class FakeTerminal implements TerminalPort {
  cols = 80;
  rows = 24;
  readonly buffer = {
    active: {
      baseY: 0,
      viewportY: 0,
    },
  };
  dispose = vi.fn();
  open = vi.fn();
  scrollToBottom = vi.fn(() => {
    this.buffer.active.viewportY = this.buffer.active.baseY;
  });
  scrollToLine = vi.fn((line: number) => {
    this.buffer.active.viewportY = line;
  });
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
  it('scrolls to the bottom before forwarding terminal input', async () => {
    const terminal = new FakeTerminal();
    const sessionClient = createSessionClient();
    const adapter = createAdapter(terminal, sessionClient);
    adapter.open(document.createElement('div'));
    terminal.scrollToBottom.mockClear();

    terminal.emitData('pwd\n');
    await Promise.resolve();

    expect(terminal.scrollToBottom).toHaveBeenCalledOnce();
    expect(sessionClient.write).toHaveBeenCalledWith(
      'session-a',
      new TextEncoder().encode('pwd\n'),
    );
    expect(terminal.scrollToBottom.mock.invocationCallOrder[0]).toBeLessThan(
      sessionClient.write.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
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

  it('keeps the viewport position when output arrives while reading history', async () => {
    const terminal = new FakeTerminal();
    const adapter = createAdapter(terminal, createSessionClient());
    adapter.open(document.createElement('div'));
    terminal.buffer.active.baseY = 100;
    terminal.buffer.active.viewportY = 40;
    terminal.scrollToLine.mockClear();

    const consumption = adapter.acceptChunk({
      sessionId: 'session-a',
      sequence: 1,
      payload: [97],
    });
    terminal.buffer.active.baseY = 101;
    terminal.buffer.active.viewportY = 41;
    terminal.completeWrite();
    await consumption;

    expect(terminal.scrollToLine).toHaveBeenCalledWith(40);
  });

  it('stays pinned to the bottom after output', async () => {
    const terminal = new FakeTerminal();
    const adapter = createAdapter(terminal, createSessionClient());
    adapter.open(document.createElement('div'));
    terminal.buffer.active.baseY = 100;
    terminal.buffer.active.viewportY = 100;
    terminal.scrollToBottom.mockClear();

    const consumption = adapter.acceptChunk({
      sessionId: 'session-a',
      sequence: 1,
      payload: [97],
    });
    terminal.buffer.active.baseY = 101;
    terminal.completeWrite();
    await consumption;

    expect(terminal.scrollToBottom).toHaveBeenCalledOnce();
  });

  it('fits again after two animation frames', () => {
    const terminal = new FakeTerminal();
    const fitAddon = createFitAddon();
    const frames = createFrameScheduler();
    const adapter = createAdapter(
      terminal,
      createSessionClient(),
      vi.fn(),
      createResizeObserver(),
      1,
      {
        fitAddon,
        frames,
      },
    );

    adapter.open(document.createElement('div'));
    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
    frames.runNextFrame();
    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
    frames.runNextFrame();
    expect(fitAddon.fit).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending post-render fit on dispose', () => {
    const terminal = new FakeTerminal();
    const frames = createFrameScheduler();
    const adapter = createAdapter(
      terminal,
      createSessionClient(),
      vi.fn(),
      createResizeObserver(),
      1,
      {
        frames,
      },
    );

    adapter.open(document.createElement('div'));
    frames.runNextFrame();
    expect(frames.pendingCount()).toBe(1);
    adapter.dispose();

    expect(frames.pendingCount()).toBe(0);
    expect(frames.cancelFrame).toHaveBeenCalledOnce();
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

  it('restores the history viewport after fitting its container', () => {
    const terminal = new FakeTerminal();
    const observer = createResizeObserver();
    const adapter = createAdapter(terminal, createSessionClient(), vi.fn(), observer);
    adapter.open(document.createElement('div'));
    terminal.buffer.active.baseY = 100;
    terminal.buffer.active.viewportY = 35;
    terminal.scrollToLine.mockClear();

    observer.trigger();

    expect(terminal.scrollToLine).toHaveBeenCalledWith(35);
  });

  it('disposes subscriptions and terminal exactly once', () => {
    const terminal = new FakeTerminal();
    const observer = createResizeObserver();
    const fitAddon = createFitAddon();
    const frames = createFrameScheduler();
    const adapter = new TerminalAdapter({
      sessionId: 'session-a',
      sessionClient: createSessionClient(),
      createTerminal: () => terminal,
      createFitAddon: () => fitAddon,
      createResizeObserver: () => observer,
      frameScheduler: frames,
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

function createResizeObserver(): ResizeObserverPort & {
  setCallback: (nextCallback: () => void) => void;
  trigger: () => void;
} {
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

function createFrameScheduler(): AnimationFrameScheduler & {
  runNextFrame: () => void;
  pendingCount: () => number;
} {
  let nextFrameId = 1;
  const callbacks = new Map<number, () => void>();
  return {
    requestFrame: vi.fn((callback: () => void) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      callbacks.set(frameId, callback);
      return frameId;
    }),
    cancelFrame: vi.fn((frameId: number) => callbacks.delete(frameId)),
    runNextFrame() {
      const nextEntry = callbacks.entries().next().value as [number, () => void] | undefined;
      if (nextEntry === undefined) {
        return;
      }
      callbacks.delete(nextEntry[0]);
      nextEntry[1]();
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

interface AdapterFixtureOptions {
  fitAddon?: FitAddonPort;
  frames?: AnimationFrameScheduler;
}

function createAdapter(
  terminal: FakeTerminal,
  sessionClient: ReturnType<typeof createSessionClient>,
  onError = vi.fn(),
  observer = createResizeObserver(),
  initialSequence = 1,
  fixtureOptions: AdapterFixtureOptions = {},
) {
  const fitAddon = fixtureOptions.fitAddon ?? createFitAddon();
  const frames = fixtureOptions.frames ?? createFrameScheduler();
  return new TerminalAdapter({
    sessionId: 'session-a',
    initialSequence,
    sessionClient,
    createTerminal: () => terminal,
    createFitAddon: () => fitAddon,
    createResizeObserver: (callback) => {
      observer.setCallback(callback);
      return observer;
    },
    frameScheduler: frames,
    onError,
  });
}
