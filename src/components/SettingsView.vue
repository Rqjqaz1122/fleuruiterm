<script setup lang="ts">
import { computed, ref } from 'vue';

import { locale, setLocale, t, type AppLocale, type TranslationKey } from '@/i18n/locale';
import { TABBY_DEFAULT_SCROLLBACK_LINES } from '@/terminal/terminalConfig';

type SettingsSectionId = 'general' | 'appearance' | 'terminal' | 'profiles' | 'hotkeys' | 'ai';

interface SettingsSection {
  id: SettingsSectionId;
  labelKey: TranslationKey;
  symbol: string;
}

const settingsSections: readonly SettingsSection[] = [
  { id: 'general', labelKey: 'settings.general', symbol: '◆' },
  { id: 'appearance', labelKey: 'settings.appearance', symbol: '◐' },
  { id: 'terminal', labelKey: 'settings.terminal', symbol: '›_' },
  { id: 'profiles', labelKey: 'settings.profiles', symbol: '⌘' },
  { id: 'hotkeys', labelKey: 'settings.hotkeys', symbol: '⌨' },
  { id: 'ai', labelKey: 'settings.ai', symbol: '✦' },
];

const selectedSectionId = ref<SettingsSectionId>('general');
const selectedLocale = computed<AppLocale>({
  get: () => locale.value,
  set: (nextLocale) => setLocale(nextLocale),
});
</script>

<template>
  <section class="settings-view" :aria-label="t('settings.aria')">
    <aside class="settings-sidebar">
      <nav class="settings-navigation" :aria-label="t('settings.sections')">
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
          {{ t(section.labelKey) }}
        </button>
      </nav>
    </aside>

    <div class="settings-content" data-testid="settings-panel">
      <Transition name="settings-section" mode="out-in">
        <div :key="selectedSectionId" class="settings-section">
          <template v-if="selectedSectionId === 'general'">
            <header class="settings-heading">
              <h1>{{ t('settings.general') }}</h1>
              <p>{{ t('settings.generalDescription') }}</p>
            </header>
            <div class="settings-group">
              <label class="setting-row">
                <span>
                  <strong>{{ t('settings.language') }}</strong>
                  <small>{{ t('settings.languageDescription') }}</small>
                </span>
                <select v-model="selectedLocale" data-testid="language-select">
                  <option value="en-US">{{ t('settings.english') }}</option>
                  <option value="zh-CN">{{ t('settings.chinese') }}</option>
                </select>
              </label>
              <label class="setting-row">
                <span>
                  <strong>{{ t('settings.openOnStartup') }}</strong>
                  <small>{{ t('settings.openOnStartupDescription') }}</small>
                </span>
                <input type="checkbox" checked disabled />
              </label>
              <label class="setting-row">
                <span>
                  <strong>{{ t('settings.closeToTray') }}</strong>
                  <small>{{ t('settings.closeToTrayDescription') }}</small>
                </span>
                <input type="checkbox" disabled />
              </label>
            </div>
          </template>

          <template v-else-if="selectedSectionId === 'appearance'">
            <header class="settings-heading">
              <h1>{{ t('settings.appearance') }}</h1>
              <p>{{ t('settings.appearanceDescription') }}</p>
            </header>
            <div class="settings-group">
              <label class="setting-row">
                <span>
                  <strong>{{ t('settings.theme') }}</strong>
                  <small>{{ t('settings.themeDescription') }}</small>
                </span>
                <select disabled>
                  <option>FleurTerm Dark</option>
                </select>
              </label>
              <label class="setting-row">
                <span>
                  <strong>{{ t('settings.interfaceFont') }}</strong>
                  <small>{{ t('settings.interfaceFontDescription') }}</small>
                </span>
                <select disabled>
                  <option>System UI</option>
                </select>
              </label>
              <label class="setting-row setting-row-stack">
                <span>
                  <strong>{{ t('settings.windowOpacity') }}</strong>
                  <small>{{ t('settings.windowOpacityDescription') }}</small>
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
              <h1>{{ t('settings.terminal') }}</h1>
              <p>{{ t('settings.terminalDescription') }}</p>
            </header>
            <div class="settings-group">
              <label class="setting-row">
                <span>
                  <strong>{{ t('settings.fontFamily') }}</strong>
                  <small>{{ t('settings.fontFamilyDescription') }}</small>
                </span>
                <input value="JetBrains Mono" disabled />
              </label>
              <label class="setting-row">
                <span>
                  <strong>{{ t('settings.fontSize') }}</strong>
                  <small>{{ t('settings.fontSizeDescription') }}</small>
                </span>
                <input type="number" value="13" disabled />
              </label>
              <label class="setting-row">
                <span>
                  <strong>{{ t('settings.cursorBlink') }}</strong>
                  <small>{{ t('settings.cursorBlinkDescription') }}</small>
                </span>
                <input type="checkbox" checked disabled />
              </label>
              <label class="setting-row">
                <span>
                  <strong>{{ t('settings.scrollback') }}</strong>
                  <small>{{ t('settings.scrollbackDescription') }}</small>
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
                  <strong>{{ t('settings.scrollOnInput') }}</strong>
                  <small>{{ t('settings.scrollOnInputDescription') }}</small>
                </span>
                <input data-testid="scroll-on-input" type="checkbox" checked disabled />
              </label>
            </div>
          </template>

          <template v-else-if="selectedSectionId === 'profiles'">
            <header class="settings-heading">
              <h1>{{ t('settings.profiles') }}</h1>
              <p>{{ t('settings.profilesDescription') }}</p>
            </header>
            <div class="settings-group">
              <div class="setting-row">
                <span>
                  <strong>{{ t('settings.localShell') }}</strong>
                  <small>{{ t('settings.localShellDescription') }}</small>
                </span>
                <button type="button" disabled>{{ t('settings.default') }}</button>
              </div>
            </div>
          </template>

          <template v-else-if="selectedSectionId === 'hotkeys'">
            <header class="settings-heading">
              <h1>{{ t('settings.hotkeys') }}</h1>
              <p>{{ t('settings.hotkeysDescription') }}</p>
            </header>
            <div class="settings-group">
              <div class="setting-row">
                <span>
                  <strong>{{ t('start.newTerminal') }}</strong>
                  <small>{{ t('start.newTerminalDescription') }}</small>
                </span>
                <kbd>⌘ T</kbd>
              </div>
              <div class="setting-row">
                <span>
                  <strong>{{ t('settings.closeTab') }}</strong>
                  <small>{{ t('settings.closeTabDescription') }}</small>
                </span>
                <kbd>⌘ W</kbd>
              </div>
            </div>
          </template>

          <template v-else>
            <header class="settings-heading">
              <h1>{{ t('settings.ai') }}</h1>
              <p>{{ t('settings.aiDescription') }}</p>
            </header>
            <div class="settings-group">
              <label class="setting-row">
                <span>
                  <strong>{{ t('settings.aiAssistant') }}</strong>
                  <small>{{ t('settings.aiAssistantDescription') }}</small>
                </span>
                <input type="checkbox" disabled />
              </label>
            </div>
          </template>
        </div>
      </Transition>
    </div>
  </section>
</template>
