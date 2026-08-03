import { readonly, shallowRef } from 'vue';

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
    return position.target;
  }
  if (!(position instanceof MouseEvent) && state.value !== null) {
    return state.value.invoker;
  }
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function close(): void {
  state.value = null;
}

export const contextMenu = {
  state: readonly(state),
  openAt,
  close,
};
