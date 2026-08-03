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
}

const state = shallowRef<ContextMenuRequest | null>(null);

function openAt(position: ContextMenuPosition | MouseEvent, entries: ContextMenuEntry[]): void {
  if (position instanceof MouseEvent) {
    position.preventDefault();
    state.value = {
      x: position.clientX,
      y: position.clientY,
      entries,
    };
    return;
  }

  state.value = {
    x: position.x,
    y: position.y,
    entries,
  };
}

function close(): void {
  state.value = null;
}

export const contextMenu = {
  state: readonly(state),
  openAt,
  close,
};
