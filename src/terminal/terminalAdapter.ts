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
  write(data: Uint8Array): void;
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
  private expectedSequence = 1;
  private disposed = false;

  constructor(private readonly options: TerminalAdapterOptions) {
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

  acceptChunk(chunk: TerminalChunk): void {
    if (chunk.sessionId !== this.options.sessionId) {
      return;
    }
    if (chunk.sequence !== this.expectedSequence) {
      this.options.onError(
        new TerminalAdapterError(
          'OUTPUT_SEQUENCE_GAP',
          `Expected terminal output sequence ${this.expectedSequence}, received ${chunk.sequence}`,
        ),
      );
      return;
    }

    this.expectedSequence += 1;
    this.terminal.write(new Uint8Array(chunk.payload));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.inputSubscription?.dispose();
    this.inputSubscription = null;
    this.resizeObserver.disconnect();
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
