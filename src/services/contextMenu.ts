import { readonly, shallowRef } from 'vue';

const FOCUSABLE_INVOKER_SELECTOR = [
  'button:not(:disabled)',
  'a[href]',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface ContextMenuActionEntry {
  kind: 'action';
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void | Promise<void>;
}

export interface ContextMenuSeparatorEntry {
  kind: 'separator';
  id: string;
}

export type ContextMenuEntry = ContextMenuActionEntry | ContextMenuSeparatorEntry;

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuRequest extends ContextMenuPosition {
  entries: ContextMenuEntry[];
  invoker: HTMLElement | null;
}

const state = shallowRef<ContextMenuRequest | null>(null);

function openAt(position: ContextMenuPosition | MouseEvent, entries: ContextMenuEntry[]): void {
  const invoker = resolveInvoker(position);
  if (position instanceof MouseEvent) {
    position.preventDefault();
    state.value = {
      x: position.clientX,
      y: position.clientY,
      entries,
      invoker,
    };
    return;
  }

  state.value = {
    x: position.x,
    y: position.y,
    entries,
    invoker,
  };
}

function resolveInvoker(position: ContextMenuPosition | MouseEvent): HTMLElement | null {
  if (position instanceof MouseEvent && position.target instanceof HTMLElement) {
    const focusableTarget = position.target.closest<HTMLElement>(FOCUSABLE_INVOKER_SELECTOR);
    if (focusableTarget !== null) {
      return focusableTarget;
    }
  }
  if (!(position instanceof MouseEvent) && state.value !== null) {
    return state.value.invoker;
  }
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && activeElement !== document.body
    ? activeElement
    : null;
}

function close(): void {
  state.value = null;
}

export const contextMenu = {
  state: readonly(state),
  openAt,
  close,
};
