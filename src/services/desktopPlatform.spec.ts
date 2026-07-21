import { describe, expect, it } from 'vitest';

import { detectDesktopPlatform } from './desktopPlatform';

describe('detectDesktopPlatform', () => {
  it('prefers the Tauri build platform', () => {
    expect(
      detectDesktopPlatform({
        buildPlatform: 'macos',
        navigatorPlatform: 'Win32',
        userAgent: 'Windows',
      }),
    ).toBe('macos');
  });

  it.each([
    ['MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos'],
    ['Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
  ] as const)(
    'detects %s as %s without a Tauri build value',
    (navigatorPlatform, userAgent, expected) => {
      expect(detectDesktopPlatform({ navigatorPlatform, userAgent })).toBe(expected);
    },
  );

  it('returns unknown when no supported platform can be identified', () => {
    expect(detectDesktopPlatform({ navigatorPlatform: '', userAgent: '' })).toBe('unknown');
  });
});
