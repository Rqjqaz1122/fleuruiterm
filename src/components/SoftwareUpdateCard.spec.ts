import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n/locale';
import type { AppUpdaterClient, AvailableAppUpdate } from '@/services/appUpdater';
import { createAppUpdateStore } from '@/stores/appUpdateStore';

import SoftwareUpdateCard from './SoftwareUpdateCard.vue';

describe('SoftwareUpdateCard', () => {
  beforeEach(() => {
    setLocale('en-US');
  });

  it('shows the installed version and current status', async () => {
    const { store, wrapper } = await mountCard(createClient());

    await store.checkForUpdate();

    expect(wrapper.get('[data-testid="software-update-card"]').text()).toContain(
      'Software updates',
    );
    expect(wrapper.text()).toContain('Current version 0.1.0');
    expect(wrapper.text()).toContain('FleurTerm is up to date');
    expect(wrapper.get('[data-testid="check-update"]').text()).toBe('Check again');
  });

  it('shows release details and starts installation', async () => {
    const update = createUpdate({
      version: '0.2.0',
      date: '2026-07-21T12:00:00Z',
      body: 'New terminal features',
    });
    const { store, wrapper } = await mountCard(createClient({ check: vi.fn(async () => update) }));
    await store.checkForUpdate();
    store.installUpdate = vi.fn(async () => undefined);

    expect(wrapper.text()).toContain('Version 0.2.0 is available');
    expect(wrapper.text()).toContain('New terminal features');
    await wrapper.get('[data-testid="install-update"]').trigger('click');

    expect(store.installUpdate).toHaveBeenCalledOnce();
  });

  it('renders determinate download progress', async () => {
    const { store, wrapper } = await mountCard(createClient());

    store.$patch({
      status: 'downloading',
      downloadedBytes: 50,
      totalBytes: 100,
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('50');
    expect(wrapper.text()).toContain('50%');
  });

  it('retries a failed update check', async () => {
    const { store, wrapper } = await mountCard(createClient());
    store.$patch({ status: 'error', errorCode: 'CHECK_FAILED' });
    store.checkForUpdate = vi.fn(async () => undefined);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Unable to check for updates');
    await wrapper.get('[data-testid="check-update"]').trigger('click');

    expect(store.checkForUpdate).toHaveBeenCalledOnce();
  });

  it('localizes update controls in Chinese', async () => {
    setLocale('zh-CN');
    const { store, wrapper } = await mountCard(createClient({ available: false }));

    await store.checkForUpdate();

    expect(wrapper.text()).toContain('软件更新');
    expect(wrapper.text()).toContain('当前版本 Development');
    expect(wrapper.text()).toContain('仅桌面应用支持检查更新');
  });
});

async function mountCard(client: AppUpdaterClient) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = createAppUpdateStore(client)();
  const wrapper = mount(SoftwareUpdateCard, { global: { plugins: [pinia] } });
  await wrapper.vm.$nextTick();
  return { store, wrapper };
}

function createClient(patch: Partial<AppUpdaterClient> = {}): AppUpdaterClient {
  const available = patch.available ?? true;
  return {
    available,
    currentVersion: vi.fn(async () => (available ? '0.1.0' : 'Development')),
    check: vi.fn(async () => null),
    restart: vi.fn(async () => undefined),
    ...patch,
  };
}

function createUpdate(patch: Partial<AvailableAppUpdate> = {}): AvailableAppUpdate {
  return {
    version: '0.2.0',
    date: null,
    body: null,
    downloadAndInstall: vi.fn(async () => undefined),
    ...patch,
  };
}
