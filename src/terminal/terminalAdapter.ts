import type { TerminalChunk } from '@/domain/session';

export interface DisposablePort {
  dispose(): void;
}

export interface FitAddonPort extends DisposablePort {
  fit(): void;
}

export interface TerminalPort extends DisposablePort {
  readonly cols: number;
  readonly rows: number;
  readonly buffer: { readonly active: TerminalBufferPort };
  open(element: HTMLElement): void;
  write(data: Uint8Array, callback?: () => void): void;
  loadAddon(addon: FitAddonPort): void;
  onData(handler: (input: string) => void): DisposablePort;
  scrollToBottom(): void;
  scrollToLine(line: number): void;
}

export interface TerminalBufferPort {
  readonly baseY: number;
  readonly viewportY: number;
}

export interface ResizeObserverPort {
  observe(element: Element): void;
  disconnect(): void;
}

export interface TerminalSessionClient {
  write(sessionId: string, input: Uint8Array): Promise<void>;
  resize(sessionId: string, columns: number, rows: number): Promise<void>;
}

export interface AnimationFrameScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(frameId: number): void;
}

export interface TerminalAdapterOptions {
  sessionId: string;
  initialSequence?: number;
  sessionClient: TerminalSessionClient;
  createTerminal: () => TerminalPort;
  createFitAddon: () => FitAddonPort;
  createResizeObserver: (callback: () => void) => ResizeObserverPort;
  frameScheduler: AnimationFrameScheduler;
  onError: (error: TerminalAdapterError) => void;
}

interface TerminalScrollState {
  pinnedToBottom: boolean;
  viewportY: number;
}

export class TerminalAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TerminalAdapterError';
  }
}

export class TerminalAdapter {
  private readonly terminal: TerminalPort;
  private readonly fitAddon: FitAddonPort;
  private readonly resizeObserver: ResizeObserverPort;
  private inputSubscription: DisposablePort | null = null;
  private readonly pendingOutputCompletions = new Set<() => void>();
  private pendingInitialFitFrameId: number | null = null;
  private lastNotifiedColumns: number | null = null;
  private lastNotifiedRows: number | null = null;
  private expectedSequence: number;
  private disposed = false;

  constructor(private readonly options: TerminalAdapterOptions) {
    this.expectedSequence = options.initialSequence ?? 1;
    this.terminal = options.createTerminal();
    this.fitAddon = options.createFitAddon();
    this.resizeObserver = options.createResizeObserver(() => this.fitAndNotify());
  }

  open(element: HTMLElement): void {
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(element);
    this.inputSubscription = this.terminal.onData((input) => {
      this.terminal.scrollToBottom();
      void this.options.sessionClient
        .write(this.options.sessionId, new TextEncoder().encode(input))
        .catch((error: unknown) => this.reportClientError(error));
    });
    this.resizeObserver.observe(element);
    this.fitAndNotify();
    this.schedulePostRenderFit();
  }

  acceptChunk(chunk: TerminalChunk): Promise<void> {
    if (chunk.sessionId !== this.options.sessionId) {
      return Promise.resolve();
    }
    if (chunk.sequence !== this.expectedSequence) {
      const sequenceError = new TerminalAdapterError(
        'OUTPUT_SEQUENCE_GAP',
        `Expected terminal output sequence ${this.expectedSequence}, received ${chunk.sequence}`,
      );
      this.options.onError(sequenceError);
      return Promise.reject(sequenceError);
    }

    this.expectedSequence += 1;
    return new Promise<void>((resolve, reject) => {
      const complete = () => {
        this.pendingOutputCompletions.delete(complete);
        resolve();
      };
    this.pendingOutputCompletions.add(complete);
    try {
      const scrollState = this.captureScrollState();
      this.terminal.write(new Uint8Array(chunk.payload), () => {
        if (!this.disposed) {
          this.restoreScrollState(scrollState);
        }
        complete();
      });
      } catch (error) {
        this.pendingOutputCompletions.delete(complete);
        reject(error instanceof Error ? error : new Error('Terminal output write failed'));
      }
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.inputSubscription?.dispose();
    this.inputSubscription = null;
    if (this.pendingInitialFitFrameId !== null) {
      this.options.frameScheduler.cancelFrame(this.pendingInitialFitFrameId);
      this.pendingInitialFitFrameId = null;
    }
    this.resizeObserver.disconnect();
    this.pendingOutputCompletions.forEach((complete) => complete());
    this.pendingOutputCompletions.clear();
    this.fitAddon.dispose();
    this.terminal.dispose();
  }

  private fitAndNotify(): void {
    if (this.disposed) {
      return;
    }
    const scrollState = this.captureScrollState();
    this.fitAddon.fit();
    this.restoreScrollState(scrollState);
    if (this.terminal.cols <= 0 || this.terminal.rows <= 0) {
      return;
    }
    if (
      this.terminal.cols === this.lastNotifiedColumns &&
      this.terminal.rows === this.lastNotifiedRows
    ) {
      return;
    }
    this.lastNotifiedColumns = this.terminal.cols;
    this.lastNotifiedRows = this.terminal.rows;
    void this.options.sessionClient
      .resize(this.options.sessionId, this.terminal.cols, this.terminal.rows)
      .catch((error: unknown) => this.reportClientError(error));
  }

  private schedulePostRenderFit(): void {
    this.pendingInitialFitFrameId = this.options.frameScheduler.requestFrame(() => {
      if (this.disposed) {
        return;
      }
      this.pendingInitialFitFrameId = this.options.frameScheduler.requestFrame(() => {
        this.pendingInitialFitFrameId = null;
        if (!this.disposed) {
          this.fitAndNotify();
        }
      });
    });
  }

  private captureScrollState(): TerminalScrollState {
    const activeBuffer = this.terminal.buffer.active;
    return {
      pinnedToBottom: activeBuffer.viewportY === activeBuffer.baseY,
      viewportY: activeBuffer.viewportY,
    };
  }

  private restoreScrollState(scrollState: TerminalScrollState): void {
    if (scrollState.pinnedToBottom) {
      this.terminal.scrollToBottom();
      return;
    }
    const maximumViewportY = this.terminal.buffer.active.baseY;
    this.terminal.scrollToLine(Math.min(scrollState.viewportY, maximumViewportY));
  }

  private reportClientError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown terminal bridge error';
    this.options.onError(new TerminalAdapterError('SESSION_CLIENT_FAILURE', message));
  }
}
