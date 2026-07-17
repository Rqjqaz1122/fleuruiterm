export type SessionState = 'created' | 'starting' | 'ready' | 'closing' | 'closed' | 'failed';

export interface SessionSnapshot {
  sessionId: string;
  backendType: 'local';
  state: SessionState;
  shell: string | null;
}

export interface TerminalChunk {
  sessionId: string;
  sequence: number;
  payload: number[];
}
