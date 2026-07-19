<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

interface AppSelectOption {
  value: string;
  label: string;
}

const props = defineProps<{
  modelValue: string;
  options: AppSelectOption[];
  ariaLabel: string;
  menuPlacement?: 'bottom' | 'top';
  testId?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const rootElement = ref<HTMLElement | null>(null);
const open = ref(false);

const selectedOption = computed(
  () => props.options.find((option) => option.value === props.modelValue) ?? props.options[0],
);

function toggle(): void {
  open.value = !open.value;
}

function selectOption(value: string): void {
  emit('update:modelValue', value);
  open.value = false;
}

function handleOutsideMouseDown(event: MouseEvent): void {
  if (rootElement.value?.contains(event.target as Node)) {
    return;
  }
  open.value = false;
}

function handleButtonKeyDown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    open.value = true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideMouseDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleOutsideMouseDown);
});
</script>

<template>
  <div ref="rootElement" class="app-select">
    <button
      class="app-select-button"
      type="button"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      :data-testid="testId"
      @click="toggle"
      @keydown.stop="handleButtonKeyDown"
    >
      <span>{{ selectedOption?.label }}</span>
      <span class="app-select-arrow" aria-hidden="true" />
    </button>

    <Transition name="app-select-menu">
      <div
        v-if="open"
        class="app-select-menu"
        :class="`app-select-menu-${props.menuPlacement ?? 'bottom'}`"
        role="listbox"
        :aria-label="ariaLabel"
      >
        <button
          v-for="option in options"
          :key="option.value"
          class="app-select-option"
          :class="{ 'is-selected': option.value === modelValue }"
          type="button"
          role="option"
          :aria-selected="option.value === modelValue"
          :data-value="option.value"
          @click="selectOption(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </Transition>
  </div>
</template>
