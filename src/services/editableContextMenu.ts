import { browserClipboard, type ClipboardPort } from '@/services/clipboard';
import { contextMenu, type ContextMenuActionEntry } from '@/services/contextMenu';

export interface EditableContextMenuLabels {
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
}

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type FormEditableTarget = HTMLInputElement | HTMLTextAreaElement;

const SELECTION_CAPABLE_INPUT_TYPES = new Set(['password', 'search', 'tel', 'text', 'url']);
const BLOCK_ELEMENT_NAMES = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'DL',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
]);

interface FormSelectionSnapshot {
  kind: 'form-control';
  target: FormEditableTarget;
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
  text: string;
  supportsSelection: boolean;
}

interface ContentEditableSelectionSnapshot {
  kind: 'contenteditable';
  target: HTMLElement;
  range: Range;
  text: string;
}

type EditableSelectionSnapshot = FormSelectionSnapshot | ContentEditableSelectionSnapshot;

export function findEditableTarget(target: EventTarget | null): EditableTarget | null {
  const targetElement = resolveTargetElement(target);
  if (targetElement === null) {
    return null;
  }

  const formControl = targetElement.closest('input, textarea');
  if (formControl instanceof HTMLInputElement) {
    return SELECTION_CAPABLE_INPUT_TYPES.has(formControl.type) ? formControl : null;
  }
  if (formControl instanceof HTMLTextAreaElement) {
    return formControl;
  }

  return findContentEditableAncestor(targetElement);
}

export function createEditableContextMenuEntries(
  target: EditableTarget,
  labels: EditableContextMenuLabels,
  clipboard: ClipboardPort = browserClipboard,
): ContextMenuActionEntry[] {
  const selection = captureSelection(target);
  const disabled = isDisabled(selection);
  const readOnly = isReadOnly(selection);
  const hasSelection = selection.text.length > 0;

  return [
    {
      kind: 'action',
      id: 'cut',
      label: labels.cut,
      disabled: disabled || readOnly || !hasSelection,
      run: () => cutSelection(selection, clipboard),
    },
    {
      kind: 'action',
      id: 'copy',
      label: labels.copy,
      disabled: disabled || !hasSelection,
      run: () => copySelection(selection, clipboard),
    },
    {
      kind: 'action',
      id: 'paste',
      label: labels.paste,
      disabled: disabled || readOnly,
      run: () => pasteSelection(selection, clipboard),
    },
    {
      kind: 'action',
      id: 'select-all',
      label: labels.selectAll,
      disabled,
      run: () => selectAll(selection),
    },
  ];
}

export function openEditableContextMenu(
  event: MouseEvent,
  labels: EditableContextMenuLabels,
  clipboard: ClipboardPort = browserClipboard,
): boolean {
  const target = findEditableTarget(event.target);
  if (target === null) {
    return false;
  }
  contextMenu.openAt(event, createEditableContextMenuEntries(target, labels, clipboard));
  return true;
}

function resolveTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }
  return target instanceof Node ? target.parentElement : null;
}

function findContentEditableAncestor(target: Element): HTMLElement | null {
  let candidate: Element | null = target;
  while (candidate instanceof HTMLElement) {
    const contentEditableValue =
      candidate.getAttribute('contenteditable') ?? candidate.contentEditable;
    if (contentEditableValue === 'false') {
      return null;
    }
    if (
      contentEditableValue === '' ||
      contentEditableValue === 'true' ||
      contentEditableValue === 'plaintext-only'
    ) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function captureSelection(target: EditableTarget): EditableSelectionSnapshot {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const supportsSelection = start !== null && end !== null;
    const resolvedStart = start ?? 0;
    const resolvedEnd = end ?? resolvedStart;
    return {
      kind: 'form-control',
      target,
      start: resolvedStart,
      end: resolvedEnd,
      direction: target.selectionDirection ?? 'none',
      text: supportsSelection ? target.value.slice(resolvedStart, resolvedEnd) : '',
      supportsSelection,
    };
  }

  const range = captureContentEditableRange(target);
  return {
    kind: 'contenteditable',
    target,
    range,
    text: serializeRangePlainText(range),
  };
}

function captureContentEditableRange(target: HTMLElement): Range {
  const selection = window.getSelection();
  if (selection !== null && selection.rangeCount > 0) {
    const selectedRange = selection.getRangeAt(0);
    if (
      target.contains(selectedRange.startContainer) &&
      target.contains(selectedRange.endContainer)
    ) {
      return selectedRange.cloneRange();
    }
  }

  const collapsedRange = document.createRange();
  collapsedRange.selectNodeContents(target);
  collapsedRange.collapse(false);
  return collapsedRange;
}

function isDisabled(selection: EditableSelectionSnapshot): boolean {
  if (selection.kind === 'contenteditable') {
    return false;
  }
  return selection.target.disabled || !selection.supportsSelection;
}

function isReadOnly(selection: EditableSelectionSnapshot): boolean {
  if (selection.kind === 'contenteditable') {
    return selection.target.getAttribute('aria-readonly') === 'true';
  }
  return selection.target.readOnly;
}

async function cutSelection(
  selection: EditableSelectionSnapshot,
  clipboard: ClipboardPort,
): Promise<void> {
  if (isDisabled(selection) || isReadOnly(selection) || selection.text.length === 0) {
    return;
  }
  await clipboard.writeText(selection.text);
  replaceSelection(selection, '', 'deleteByCut');
}

async function copySelection(
  selection: EditableSelectionSnapshot,
  clipboard: ClipboardPort,
): Promise<void> {
  if (isDisabled(selection) || selection.text.length === 0) {
    return;
  }
  restoreSelection(selection);
  await clipboard.writeText(selection.text);
}

async function pasteSelection(
  selection: EditableSelectionSnapshot,
  clipboard: ClipboardPort,
): Promise<void> {
  if (isDisabled(selection) || isReadOnly(selection)) {
    return;
  }
  replaceSelection(selection, await clipboard.readText(), 'insertFromPaste');
}

function replaceSelection(
  selection: EditableSelectionSnapshot,
  replacement: string,
  inputType: 'deleteByCut' | 'insertFromPaste',
): void {
  let inputData: string | null = inputType === 'deleteByCut' ? null : replacement;
  if (selection.kind === 'form-control') {
    selection.target.focus();
    selection.target.setRangeText(replacement, selection.start, selection.end, 'end');
  } else {
    inputData = replaceContentEditableSelection(selection, replacement, inputType);
  }
  selection.target.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      data: inputData,
      inputType,
    }),
  );
}

function replaceContentEditableSelection(
  selection: ContentEditableSelectionSnapshot,
  replacement: string,
  inputType: 'deleteByCut' | 'insertFromPaste',
): string | null {
  const normalizedReplacement = replacement.replace(/\r\n?/g, '\n');
  const replacementFragment = createPlainTextFragment(normalizedReplacement);
  const lastReplacementNode = replacementFragment.lastChild;
  selection.range.deleteContents();
  if (lastReplacementNode !== null) {
    selection.range.insertNode(replacementFragment);
    selection.range.setStartAfter(lastReplacementNode);
  }
  selection.range.collapse(true);
  restoreSelection(selection);
  return inputType === 'deleteByCut' ? null : normalizedReplacement;
}

function createPlainTextFragment(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (index > 0) {
      fragment.append(document.createElement('br'));
    }
    if (line.length > 0) {
      fragment.append(document.createTextNode(line));
    }
  });
  return fragment;
}

function serializeRangePlainText(range: Range): string {
  return serializePlainTextFragment(range.cloneContents());
}

function serializePlainTextFragment(fragment: DocumentFragment): string {
  let plainText = '';
  let blockBoundaryPending = false;

  const appendPendingBlockBoundary = (): void => {
    if (blockBoundaryPending && plainText.length > 0 && !plainText.endsWith('\n')) {
      plainText += '\n';
    }
    blockBoundaryPending = false;
  };

  const appendNode = (node: Node): void => {
    if (node instanceof Text) {
      if (node.data.length > 0) {
        appendPendingBlockBoundary();
        plainText += node.data;
      }
      return;
    }
    if (!(node instanceof Element)) {
      node.childNodes.forEach(appendNode);
      return;
    }
    if (node.tagName === 'BR') {
      appendPendingBlockBoundary();
      plainText += '\n';
      return;
    }

    const blockElement = BLOCK_ELEMENT_NAMES.has(node.tagName);
    if (blockElement) {
      appendPendingBlockBoundary();
      if (plainText.length > 0 && !plainText.endsWith('\n')) {
        plainText += '\n';
      }
    }
    node.childNodes.forEach(appendNode);
    if (blockElement) {
      blockBoundaryPending = true;
    }
  };

  fragment.childNodes.forEach(appendNode);
  return plainText;
}

function restoreSelection(selection: EditableSelectionSnapshot): void {
  selection.target.focus();
  if (selection.kind === 'form-control') {
    selection.target.setSelectionRange(selection.start, selection.end, selection.direction);
    return;
  }
  const browserSelection = window.getSelection();
  browserSelection?.removeAllRanges();
  browserSelection?.addRange(selection.range);
}

function selectAll(selection: EditableSelectionSnapshot): void {
  if (isDisabled(selection)) {
    return;
  }
  selection.target.focus();
  if (selection.kind === 'form-control') {
    selection.target.setSelectionRange(0, selection.target.value.length);
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(selection.target);
  const browserSelection = window.getSelection();
  browserSelection?.removeAllRanges();
  browserSelection?.addRange(range);
}
