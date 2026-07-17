<script setup lang="ts">
defineProps<{ pending: boolean }>();

defineEmits<{
  createTerminal: [];
  openSettings: [];
}>();
</script>

<template>
  <section class="start-page" aria-labelledby="start-page-title">
    <div class="start-page-content">
      <div class="start-brand-mark" aria-hidden="true">›_</div>
      <h1 id="start-page-title">FleurTerm</h1>
      <p class="start-brand-caption">Terminal workspace by FleurUI</p>

      <div class="start-action-list" aria-label="Get started">
        <div
          class="start-action start-action-static"
          data-testid="profiles-entry"
          aria-disabled="true"
        >
          <span class="start-action-icon" aria-hidden="true">⌘</span>
          <span>
            <strong>Profiles &amp; connections</strong>
            <small>Configure shells and remote hosts</small>
          </span>
        </div>
        <button
          class="start-action"
          data-testid="start-new-terminal"
          type="button"
          :disabled="pending"
          @click="$emit('createTerminal')"
        >
          <span class="start-action-icon" aria-hidden="true">›_</span>
          <span>
            <strong>{{ pending ? 'Opening…' : 'New terminal' }}</strong>
            <small>Open the default local shell</small>
          </span>
        </button>
        <div
          class="start-action start-action-static"
          data-testid="recent-entry"
          aria-disabled="true"
        >
          <span class="start-action-icon" aria-hidden="true">◷</span>
          <span>
            <strong>Recent connections</strong>
            <small>Reopen a previous session</small>
          </span>
        </div>
        <button
          class="start-action"
          data-testid="start-settings"
          type="button"
          @click="$emit('openSettings')"
        >
          <span class="start-action-icon" aria-hidden="true">⚙</span>
          <span>
            <strong>Settings</strong>
            <small>Appearance, terminal and shortcuts</small>
          </span>
        </button>
      </div>
    </div>
  </section>
</template>
