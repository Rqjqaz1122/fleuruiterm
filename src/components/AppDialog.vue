<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    ariaLabel: string;
    width?: string;
    panelClass?: string;
    closeOnBackdrop?: boolean;
  }>(),
  {
    width: '720px',
    panelClass: '',
    closeOnBackdrop: true,
  },
);

const emit = defineEmits<{
  close: [];
}>();

const layerStyle = computed(() => ({
  '--app-dialog-width': props.width,
}));

function closeFromBackdrop(): void {
  if (props.closeOnBackdrop) {
    emit('close');
  }
}
</script>

<template>
  <Transition name="app-dialog" appear>
    <div
      v-if="open"
      class="app-dialog-layer"
      :style="layerStyle"
      @mousedown.self="closeFromBackdrop"
    >
      <div
        class="app-dialog-panel"
        :class="panelClass"
        role="dialog"
        aria-modal="true"
        :aria-label="ariaLabel"
        @mousedown.stop
      >
        <slot />
      </div>
    </div>
  </Transition>
</template>
