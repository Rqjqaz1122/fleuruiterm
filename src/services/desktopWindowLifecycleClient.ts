import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

const APPLICATION_EXIT_REQUESTED_EVENT = 'fleurterm://application-exit-requested';

export type WindowCloseRequestHandler = () => Promise<boolean>;

export class DesktopWindowLifecycleClient {
  get available(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  async listenForCloseRequest(
    handler: WindowCloseRequestHandler,
    onFailure: () => void = () => undefined,
  ): Promise<UnlistenFn> {
    if (!this.available) {
      return () => undefined;
    }
    const appWindow = getCurrentWindow();
    return appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      if (await handler()) {
        try {
          await invoke('approve_application_exit');
          await appWindow.destroy();
        } catch {
          await invoke('revoke_application_exit').catch(() => undefined);
          onFailure();
        }
      }
    });
  }

  async listenForApplicationExitRequest(
    handler: WindowCloseRequestHandler,
    onFailure: () => void = () => undefined,
  ): Promise<UnlistenFn> {
    if (!this.available) {
      return () => undefined;
    }
    let completingExit = false;
    return listen(APPLICATION_EXIT_REQUESTED_EVENT, async () => {
      if (completingExit) {
        return;
      }
      if (await handler()) {
        completingExit = true;
        try {
          await invoke('complete_application_exit');
        } catch {
          completingExit = false;
          onFailure();
        }
      }
    });
  }
}

export const desktopWindowLifecycleClient = new DesktopWindowLifecycleClient();
