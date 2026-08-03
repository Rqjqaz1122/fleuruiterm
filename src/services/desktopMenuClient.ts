import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

import type { AppLocale } from '@/i18n/locale';
import type { AppCommand } from '@/services/appShortcuts';

const MENU_ACTION_EVENT = 'fleurterm://menu-action';

export class DesktopMenuClient {
  constructor(
    private readonly invokeCommand: <T>(
      command: string,
      payload?: Record<string, unknown>,
    ) => Promise<T> = invoke,
  ) {}

  get available(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  async listen(commandHandler: (command: AppCommand) => void): Promise<UnlistenFn> {
    if (!this.available) {
      return () => undefined;
    }
    return listen<string>(MENU_ACTION_EVENT, (event) => {
      if (isAppCommand(event.payload)) {
        commandHandler(event.payload);
      }
    });
  }

  async setLocale(locale: AppLocale): Promise<void> {
    if (!this.available && this.invokeCommand === invoke) {
      return;
    }
    await this.invokeCommand('set_application_menu_locale', { locale });
  }
}

function isAppCommand(value: string): value is AppCommand {
  return (
    value === 'new-terminal' ||
    value === 'close-tab' ||
    value === 'next-tab' ||
    value === 'previous-tab' ||
    value === 'open-settings' ||
    value === 'toggle-ai' ||
    value === 'clear-terminal'
  );
}

export const desktopMenuClient = new DesktopMenuClient();
