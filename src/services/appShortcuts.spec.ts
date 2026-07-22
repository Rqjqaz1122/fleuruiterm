import { describe, expect, it } from 'vitest';

import {
  APP_SHORTCUTS,
  captureShortcutBinding,
  findShortcutConflict,
  formatShortcutKeys,
  resolveAppShortcut,
  resolveShortcutBinding,
  sanitizeShortcutSettings,
  type ShortcutSettings,
} from './appShortcuts';

describe('application shortcuts', () => {
  it('captures a platform-aware shortcut from a keyboard event', () => {
    const binding = captureShortcutBinding(
      new KeyboardEvent('keydown', { key: 'j', metaKey: true, shiftKey: true }),
      'macos',
    );

    expect(binding).toEqual({ key: 'j', modifier: 'primary', shift: true });
    expect(formatShortcutKeys(binding!, 'macos')).toEqual(['⌘', '⇧', 'J']);
  });

  it('rejects modifier-only and unmodified character shortcuts', () => {
    expect(
      captureShortcutBinding(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }), 'macos'),
    ).toBeNull();
    expect(captureShortcutBinding(new KeyboardEvent('keydown', { key: 'j' }), 'macos')).toBeNull();
  });

  it('resolves a customized application shortcut instead of its default', () => {
    const settings: ShortcutSettings = {
      'new-terminal': { key: 'j', modifier: 'primary', shift: true },
    };

    expect(
      resolveAppShortcut(
        new KeyboardEvent('keydown', { key: 'j', metaKey: true, shiftKey: true }),
        settings,
        'macos',
      ),
    ).toBe('new-terminal');
    expect(
      resolveAppShortcut(
        new KeyboardEvent('keydown', { key: 't', metaKey: true }),
        settings,
        'macos',
      ),
    ).toBeNull();
  });

  it('supports clearing an application shortcut', () => {
    const settings: ShortcutSettings = { 'new-terminal': null };

    expect(resolveShortcutBinding('new-terminal', settings)).toBeNull();
    expect(
      resolveAppShortcut(
        new KeyboardEvent('keydown', { key: 't', metaKey: true }),
        settings,
        'macos',
      ),
    ).toBeNull();
  });

  it('detects another action using the same physical shortcut', () => {
    const settings: ShortcutSettings = {
      'new-terminal': { key: 'j', modifier: 'primary', shift: true },
    };

    expect(
      findShortcutConflict(
        'close-tab',
        { key: 'j', modifier: 'primary', shift: true },
        settings,
        'macos',
      ),
    ).toBe('new-terminal');
  });

  it('ignores malformed persisted shortcut settings', () => {
    const settings = sanitizeShortcutSettings({
      'new-terminal': { key: '', modifier: 'primary' },
      'close-tab': { key: 'q', modifier: 'invalid' },
      'open-settings': null,
      unknown: { key: 'x', modifier: 'primary' },
    });

    expect(settings).toEqual({ 'open-settings': null });
    expect(APP_SHORTCUTS.some((shortcut) => shortcut.id === 'open-settings')).toBe(true);
  });
});
