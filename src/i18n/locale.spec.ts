import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale, t } from './locale';

describe('application locale', () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale('en-US');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('switches translated messages and persists the selected locale', () => {
    setLocale('zh-CN');

    expect(t('settings.general')).toBe('常规');
    expect(localStorage.getItem('fleurterm.locale')).toBe('zh-CN');
  });

  it('translates editing and terminal context actions in English and Chinese', () => {
    expect([
      t('contextMenu.cut'),
      t('contextMenu.copy'),
      t('contextMenu.paste'),
      t('contextMenu.selectAll'),
      t('contextMenu.clearTerminal'),
    ]).toEqual(['Cut', 'Copy', 'Paste', 'Select All', 'Clear Terminal']);

    setLocale('zh-CN');

    expect([
      t('contextMenu.cut'),
      t('contextMenu.copy'),
      t('contextMenu.paste'),
      t('contextMenu.selectAll'),
      t('contextMenu.clearTerminal'),
    ]).toEqual(['剪切', '复制', '粘贴', '全选', '清空终端']);
  });

  it('uses the system language when no locale was selected', async () => {
    vi.resetModules();
    localStorage.clear();
    vi.stubGlobal('navigator', {
      language: 'zh-CN',
      languages: ['zh-CN', 'en-US'],
    });

    const { locale } = await import('./locale');

    expect(locale.value).toBe('zh-CN');
  });
});
