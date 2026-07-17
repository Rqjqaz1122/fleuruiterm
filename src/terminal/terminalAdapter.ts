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
  open(element: HTMLElement): void;
  write(data: Uint8Array, callback?: () => void): void;
  loadAddon(addon: FitAddonPort): void;
  onData(handler: (input: string) => void): DisposablePort;
}

export interface ResizeObserverPort {
  observe(element: Element): void;
  disconnect(): void;
}

export interface TerminalSessionClient {
  write(sessionId: string, input: Uint8Array): Promise<void>;
  resize(sessionId: string, columns: number, rows: number): Promise<void>;
}

export interface TerminalAdapterOptions {
  sessionId: string;
  initialSequence?: number;
  sessionClient: TerminalSessionClient;
  createTerminal: () => TerminalPort;
  createFitAddon: () => FitAddonPort;
  createResizeObserver: (callback: () => void) => ResizeObserverPort;
  onError: (error: TerminalAdapterError) => void;
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
      void this.options.sessionClient
        .write(this.options.sessionId, new TextEncoder().encode(input))
        .catch((error: unknown) => this.reportClientError(error));
    });
    this.resizeObserver.observe(element);
    this.fitAndNotify();
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
        this.terminal.write(new Uint8Array(chunk.payload), complete);
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
    this.resizeObserver.disconnect();
    this.pendingOutputCompletions.forEach((complete) => complete());
    this.pendingOutputCompletions.clear();
    this.fitAddon.dispose();
    this.terminal.dispose();
  }

  private fitAndNotify(): void {
    this.fitAddon.fit();
    if (this.terminal.cols <= 0 || this.terminal.rows <= 0) {
      return;
    }
    void this.options.sessionClient
      .resize(this.options.sessionId, this.terminal.cols, this.terminal.rows)
      .catch((error: unknown) => this.reportClientError(error));
  }

  private reportClientError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown terminal bridge error';
    this.options.onError(new TerminalAdapterError('SESSION_CLIENT_FAILURE', message));
  }
}
