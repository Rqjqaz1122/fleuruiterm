export type TerminalEditingCommand = 'copy' | 'paste' | 'select-all';

export interface TerminalEditingPort {
  getSelection(): string;
  paste(text: string): void;
  selectAll(): void;
}

export class TerminalEditingActions {
  private readonly terminalByPaneId = new Map<string, TerminalEditingPort>();

  register(paneId: string, terminal: TerminalEditingPort): () => void {
    this.terminalByPaneId.set(paneId, terminal);
    return () => {
      if (this.terminalByPaneId.get(paneId) === terminal) {
        this.terminalByPaneId.delete(paneId);
      }
    };
  }

  async execute(paneId: string, command: TerminalEditingCommand): Promise<void> {
    const terminal = this.terminalByPaneId.get(paneId);
    if (terminal === undefined) {
      return;
    }
    switch (command) {
      case 'copy': {
        const selection = terminal.getSelection();
        if (selection && navigator.clipboard !== undefined) {
          await navigator.clipboard.writeText(selection);
        }
        return;
      }
      case 'paste':
        if (navigator.clipboard !== undefined) {
          terminal.paste(await navigator.clipboard.readText());
        }
        return;
      case 'select-all':
        terminal.selectAll();
        return;
    }
  }
}

export const terminalEditingActions = new TerminalEditingActions();
