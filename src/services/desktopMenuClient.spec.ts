import { describe, expect, it, vi } from 'vitest';

import { DesktopMenuClient } from './desktopMenuClient';

describe('DesktopMenuClient', () => {
  it('updates the native application menu locale', async () => {
    const invoke = vi.fn(async () => undefined);
    const client = new DesktopMenuClient(invoke);

    await client.setLocale('zh-CN');

    expect(invoke).toHaveBeenCalledWith('set_application_menu_locale', { locale: 'zh-CN' });
  });
});
