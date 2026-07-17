import { beforeEach, describe, expect, it } from 'vitest';

import { setLocale, t } from './locale';

describe('application locale', () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale('en-US');
  });

  it('switches translated messages and persists the selected locale', () => {
    setLocale('zh-CN');

    expect(t('settings.general')).toBe('常规');
    expect(localStorage.getItem('fleurterm.locale')).toBe('zh-CN');
  });
});
