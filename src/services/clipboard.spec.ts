import { describe, expect, it, vi } from 'vitest';

import { browserClipboard } from './clipboard';

describe('browserClipboard', () => {
  it('delegates reads and writes to the navigator clipboard with the correct receiver', async () => {
    const navigatorClipboard = {
      readText: vi.fn(function (this: Clipboard) {
        expect(this).toBe(navigatorClipboard);
        return Promise.resolve('clipboard text');
      }),
      writeText: vi.fn(function (this: Clipboard, text: string) {
        expect(this).toBe(navigatorClipboard);
        expect(text).toBe('copied text');
        return Promise.resolve();
      }),
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: navigatorClipboard,
    });

    await expect(browserClipboard.readText()).resolves.toBe('clipboard text');
    await expect(browserClipboard.writeText('copied text')).resolves.toBeUndefined();
  });

  it('rejects predictably when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    await expect(browserClipboard.readText()).rejects.toThrow('Clipboard API is unavailable');
    await expect(browserClipboard.writeText('text')).rejects.toThrow(
      'Clipboard API is unavailable',
    );
  });
});
