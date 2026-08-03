import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contextMenu, type ContextMenuActionEntry } from './contextMenu';
import {
  createEditableContextMenuEntries,
  findEditableTarget,
  openEditableContextMenu,
  type ClipboardPort,
} from './editableContextMenu';

const labels = {
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select All',
};

describe('editableContextMenu', () => {
  beforeEach(() => {
    contextMenu.close();
    document.body.replaceChildren();
  });

  it('finds input, textarea, and contenteditable ancestors', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editor = document.createElement('div');
    const editorChild = document.createElement('span');
    editor.contentEditable = 'true';
    editor.append(editorChild);

    expect(findEditableTarget(input)).toBe(input);
    expect(findEditableTarget(textarea)).toBe(textarea);
    expect(findEditableTarget(editorChild)).toBe(editor);
    expect(findEditableTarget(document.createElement('button'))).toBeNull();
  });

  it('opens the standard editing actions for a nested editable target', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 25,
      clientY: 40,
    });
    Object.defineProperty(event, 'target', { value: input });

    const opened = openEditableContextMenu(event, labels, createClipboard());

    expect(opened).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(contextMenu.state.value?.entries.map((entry) => entry.id)).toEqual([
      'cut',
      'copy',
      'paste',
      'select-all',
    ]);
  });

  it('copies the input selection captured before menu focus changes', async () => {
    const input = document.createElement('input');
    input.value = 'FleurTerm';
    input.setSelectionRange(0, 5, 'forward');
    const clipboard = createClipboard();
    const entries = createEditableContextMenuEntries(input, labels, clipboard);
    input.setSelectionRange(5, 9);

    await runAction(entries, 'copy');

    expect(clipboard.writeText).toHaveBeenCalledWith('Fleur');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  it('cuts the captured input selection and dispatches a bubbling input event', async () => {
    const input = document.createElement('input');
    input.value = 'FleurTerm';
    input.setSelectionRange(0, 5);
    const inputEvents: InputEvent[] = [];
    input.addEventListener('input', (event) => inputEvents.push(event as InputEvent));
    const clipboard = createClipboard();
    const entries = createEditableContextMenuEntries(input, labels, clipboard);
    input.setSelectionRange(9, 9);

    await runAction(entries, 'cut');

    expect(clipboard.writeText).toHaveBeenCalledWith('Fleur');
    expect(input.value).toBe('Term');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(0);
    expect(inputEvents).toHaveLength(1);
    expect(inputEvents[0]).toMatchObject({ bubbles: true, inputType: 'deleteByCut' });
  });

  it('pastes over the captured textarea selection and leaves the caret after inserted text', async () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'hello world';
    textarea.setSelectionRange(6, 11);
    const inputEvents: InputEvent[] = [];
    textarea.addEventListener('input', (event) => inputEvents.push(event as InputEvent));
    const clipboard = createClipboard('FleurTerm');
    const entries = createEditableContextMenuEntries(textarea, labels, clipboard);
    textarea.setSelectionRange(0, 0);

    await runAction(entries, 'paste');

    expect(textarea.value).toBe('hello FleurTerm');
    expect(textarea.selectionStart).toBe(15);
    expect(textarea.selectionEnd).toBe(15);
    expect(inputEvents).toHaveLength(1);
    expect(inputEvents[0]).toMatchObject({ bubbles: true, inputType: 'insertFromPaste' });
  });

  it('selects all input text from the selection captured by the menu', async () => {
    const input = document.createElement('input');
    input.value = 'FleurTerm';
    input.setSelectionRange(4, 4);

    await runAction(
      createEditableContextMenuEntries(input, labels, createClipboard()),
      'select-all',
    );

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('disables mutations for readonly controls while keeping selection actions available', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'read only';
    textarea.readOnly = true;
    textarea.setSelectionRange(0, 4);

    const entries = createEditableContextMenuEntries(textarea, labels, createClipboard());

    expect(action(entries, 'cut').disabled).toBe(true);
    expect(action(entries, 'paste').disabled).toBe(true);
    expect(action(entries, 'copy').disabled).toBe(false);
    expect(action(entries, 'select-all').disabled).toBe(false);
  });

  it('disables every action for disabled form controls', () => {
    const input = document.createElement('input');
    input.value = 'disabled';
    input.disabled = true;
    input.setSelectionRange(0, 8);

    const entries = createEditableContextMenuEntries(input, labels, createClipboard());

    expect(entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'action', disabled: true })]),
    );
    expect(entries.every((entry) => entry.kind === 'action' && entry.disabled)).toBe(true);
  });

  it('preserves a contenteditable range for copy, paste, and caret placement', async () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = 'hello world';
    document.body.append(editor);
    selectText(editor.firstChild ?? editor, 6, 11);
    const clipboard = createClipboard('FleurTerm');
    const entries = createEditableContextMenuEntries(editor, labels, clipboard);
    window.getSelection()?.removeAllRanges();

    await runAction(entries, 'copy');
    await runAction(entries, 'paste');

    expect(clipboard.writeText).toHaveBeenCalledWith('world');
    expect(editor.textContent).toBe('hello FleurTerm');
    expect(window.getSelection()?.toString()).toBe('');
    expect(window.getSelection()?.anchorOffset).toBe(2);
  });

  it('does not mutate text when the default Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const input = document.createElement('input');
    input.value = 'keep this text';
    input.setSelectionRange(0, 4);
    const entries = createEditableContextMenuEntries(input, labels);

    await expect(runAction(entries, 'cut')).rejects.toThrow('Clipboard API is unavailable');
    await expect(runAction(entries, 'paste')).rejects.toThrow('Clipboard API is unavailable');

    expect(input.value).toBe('keep this text');
  });
});

function createClipboard(text = ''): ClipboardPort & {
  readText: ReturnType<typeof vi.fn>;
  writeText: ReturnType<typeof vi.fn>;
} {
  return {
    readText: vi.fn(async () => text),
    writeText: vi.fn(async () => undefined),
  };
}

function action(entries: ContextMenuActionEntry[], id: string): ContextMenuActionEntry {
  const matchingEntry = entries.find((entry) => entry.id === id);
  if (matchingEntry === undefined) {
    throw new Error(`Expected editable context action: ${id}`);
  }
  return matchingEntry;
}

async function runAction(entries: ContextMenuActionEntry[], id: string): Promise<void> {
  await action(entries, id).run();
}

function selectText(node: Node, start: number, end: number): void {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
