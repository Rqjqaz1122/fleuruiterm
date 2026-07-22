import { afterEach, describe, expect, it, vi } from 'vitest';

import { TerminalEditingActions } from './terminalEditingActions';

describe('terminal editing actions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('copies, pastes, and selects through the registered terminal', async () => {
    const writeText = vi.fn(async () => undefined);
    const readText = vi.fn(async () => 'clipboard text');
    vi.stubGlobal('navigator', { clipboard: { readText, writeText } });
    const actions = new TerminalEditingActions();
    const terminal = {
      getSelection: vi.fn(() => 'selected text'),
      paste: vi.fn(),
      selectAll: vi.fn(),
    };
    actions.register('pane-1', terminal);

    await actions.execute('pane-1', 'copy');
    await actions.execute('pane-1', 'paste');
    await actions.execute('pane-1', 'select-all');

    expect(writeText).toHaveBeenCalledWith('selected text');
    expect(terminal.paste).toHaveBeenCalledWith('clipboard text');
    expect(terminal.selectAll).toHaveBeenCalledOnce();
  });

  it('stops dispatching after a terminal unregisters', async () => {
    const actions = new TerminalEditingActions();
    const terminal = {
      getSelection: vi.fn(() => ''),
      paste: vi.fn(),
      selectAll: vi.fn(),
    };
    const unregister = actions.register('pane-1', terminal);
    unregister();

    await actions.execute('pane-1', 'select-all');

    expect(terminal.selectAll).not.toHaveBeenCalled();
  });
});
