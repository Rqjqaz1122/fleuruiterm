import { invoke } from '@tauri-apps/api/core';

export interface AppSettingsPayload {
  exists: boolean;
  path: string;
  settings: Record<string, unknown> | null;
  error: string | null;
}

/** Persistent app settings live in Tauri's app config directory, never in the browser cache. */
export class SettingsClient {
  get available(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  async load(): Promise<AppSettingsPayload | null> {
    if (!this.available) {
      return null;
    }
    try {
      return (await invoke('load_app_settings')) as AppSettingsPayload;
    } catch {
      return null;
    }
  }

  async save(settings: Record<string, unknown>): Promise<void> {
    if (!this.available) {
      return;
    }
    await invoke('save_app_settings', { settings });
  }

  async loadPasswords(connectionIds: string[]): Promise<Record<string, string>> {
    if (!this.available) {
      return {};
    }
    try {
      return (await invoke('load_connection_passwords', { connectionIds })) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async savePassword(connectionId: string, password: string): Promise<void> {
    if (!this.available) {
      return;
    }
    try {
      await invoke('save_connection_password', { connectionId, password });
    } catch {
      // The browser test environment and non-Tauri previews do not expose the vault.
    }
  }

  async deletePassword(connectionId: string): Promise<void> {
    if (!this.available) {
      return;
    }
    try {
      await invoke('delete_connection_password', { connectionId });
    } catch {
      // See savePassword.
    }
  }

  async setWindowOpacity(opacity: number): Promise<void> {
    if (!this.available) {
      return;
    }
    await invoke('set_window_opacity', { opacity });
  }
}

export const settingsClient = new SettingsClient();
