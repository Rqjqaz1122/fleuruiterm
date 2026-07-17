import { readonly, ref } from 'vue';

import type { AppTab } from '@/domain/appTab';

const draggedTabState = ref<AppTab | null>(null);

export const draggedTab = readonly(draggedTabState);

export function beginTabDrag(tab: AppTab): void {
  draggedTabState.value = tab;
}

export function finishTabDrag(): void {
  draggedTabState.value = null;
}
