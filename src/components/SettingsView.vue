<script setup lang="ts">
import { ref } from 'vue';

import { TABBY_DEFAULT_SCROLLBACK_LINES } from '@/terminal/terminalConfig';

type SettingsSectionId = 'general' | 'appearance' | 'terminal' | 'profiles' | 'hotkeys' | 'ai';

interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  symbol: string;
}

const settingsSections: readonly SettingsSection[] = [
  { id: 'general', label: 'General', symbol: '◆' },
  { id: 'appearance', label: 'Appearance', symbol: '◐' },
  { id: 'terminal', label: 'Terminal', symbol: '›_' },
  { id: 'profiles', label: 'Profiles & connections', symbol: '⌘' },
  { id: 'hotkeys', label: 'Hotkeys', symbol: '⌨' },
  { id: 'ai', label: 'AI', symbol: '✦' },
];

const selectedSectionId = ref<SettingsSectionId>('general');
</script>

<template>
  <section class="settings-view" aria-label="Settings">
    <aside class="settings-sidebar">
      <nav class="settings-navigation" aria-label="Settings sections">
        <button
          v-for="section in settingsSections"
          :key="section.id"
          class="settings-navigation-item"
          :class="{ active: selectedSectionId === section.id }"
          :data-section="section.id"
          type="button"
          :aria-current="selectedSectionId === section.id ? 'page' : undefined"
          @click="selectedSectionId = section.id"
        >
          <span class="settings-navigation-icon" aria-hidden="true">{{ section.symbol }}</span>
          {{ section.label }}
        </button>
      </nav>
    </aside>

    <div class="settings-content" data-testid="settings-panel">
      <template v-if="selectedSectionId === 'general'">
        <header class="settings-heading">
          <h1>General</h1>
          <p>Application startup and window behaviour.</p>
        </header>
        <div class="settings-group">
          <label class="setting-row">
            <span>
              <strong>Open a terminal on startup</strong>
              <small>Use the default profile.</small>
            </span>
            <input type="checkbox" checked disabled />
          </label>
          <label class="setting-row">
            <span>
              <strong>Close to tray</strong>
              <small>Keep FleurTerm running.</small>
            </span>
            <input type="checkbox" disabled />
          </label>
        </div>
      </template>

      <template v-else-if="selectedSectionId === 'appearance'">
        <header class="settings-heading">
          <h1>Appearance</h1>
          <p>Theme, type and window presentation.</p>
        </header>
        <div class="settings-group">
          <label class="setting-row">
            <span>
              <strong>Theme</strong>
              <small>Application colour scheme.</small>
            </span>
            <select disabled>
              <option>FleurTerm Dark</option>
            </select>
          </label>
          <label class="setting-row">
            <span>
              <strong>Interface font</strong>
              <small>Used outside the terminal.</small>
            </span>
            <select disabled>
              <option>System UI</option>
            </select>
          </label>
          <label class="setting-row setting-row-stack">
            <span>
              <strong>Window opacity</strong>
              <small>Opaque by default.</small>
            </span>
            <span class="setting-range">
              <input type="range" min="40" max="100" value="100" disabled />
              <output data-testid="opacity-value">100%</output>
            </span>
          </label>
        </div>
      </template>

      <template v-else-if="selectedSectionId === 'terminal'">
        <header class="settings-heading">
          <h1>Terminal</h1>
          <p>Shell rendering and scrollback.</p>
        </header>
        <div class="settings-group">
          <label class="setting-row">
            <span>
              <strong>Font family</strong>
              <small>Terminal monospace font.</small>
            </span>
            <input value="JetBrains Mono" disabled />
          </label>
          <label class="setting-row">
            <span>
              <strong>Font size</strong>
              <small>Measured in pixels.</small>
            </span>
            <input type="number" value="13" disabled />
          </label>
          <label class="setting-row">
            <span>
              <strong>Cursor blink</strong>
              <small>Animate the terminal cursor.</small>
            </span>
            <input type="checkbox" checked disabled />
          </label>
          <label class="setting-row">
            <span>
              <strong>Scrollback</strong>
              <small>Number of lines kept in the buffer.</small>
            </span>
            <input
              data-testid="scrollback-lines"
              type="number"
              :value="TABBY_DEFAULT_SCROLLBACK_LINES"
              disabled
            />
          </label>
          <label class="setting-row">
            <span>
              <strong>Scroll on input</strong>
              <small>Scroll to the bottom when typing.</small>
            </span>
            <input data-testid="scroll-on-input" type="checkbox" checked disabled />
          </label>
        </div>
      </template>

      <template v-else-if="selectedSectionId === 'profiles'">
        <header class="settings-heading">
          <h1>Profiles &amp; connections</h1>
          <p>Shell profiles and remote hosts.</p>
        </header>
        <div class="settings-group">
          <div class="setting-row">
            <span>
              <strong>Local shell</strong>
              <small>Default system login shell.</small>
            </span>
            <button type="button" disabled>Default</button>
          </div>
        </div>
      </template>

      <template v-else-if="selectedSectionId === 'hotkeys'">
        <header class="settings-heading">
          <h1>Hotkeys</h1>
          <p>Keyboard shortcuts for terminal actions.</p>
        </header>
        <div class="settings-group">
          <div class="setting-row">
            <span>
              <strong>New terminal</strong>
              <small>Create a local terminal tab.</small>
            </span>
            <kbd>⌘ T</kbd>
          </div>
          <div class="setting-row">
            <span>
              <strong>Close tab</strong>
              <small>Close the active terminal tab.</small>
            </span>
            <kbd>⌘ W</kbd>
          </div>
        </div>
      </template>

      <template v-else>
        <header class="settings-heading">
          <h1>AI</h1>
          <p>Assistant presentation and context controls.</p>
        </header>
        <div class="settings-group">
          <label class="setting-row">
            <span>
              <strong>AI assistant</strong>
              <small>Show assistant controls in terminal sessions.</small>
            </span>
            <input type="checkbox" disabled />
          </label>
        </div>
      </template>
    </div>
  </section>
</template>
