const CLIPBOARD_UNAVAILABLE_MESSAGE = 'Clipboard API is unavailable';

export interface ClipboardPort {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export const browserClipboard: ClipboardPort = {
  async readText(): Promise<string> {
    const readText = resolveNavigatorClipboardMethod('readText');
    if (readText === null) {
      throw new Error(CLIPBOARD_UNAVAILABLE_MESSAGE);
    }
    return readText();
  },
  async writeText(text: string): Promise<void> {
    const writeText = resolveNavigatorClipboardMethod('writeText');
    if (writeText === null) {
      throw new Error(CLIPBOARD_UNAVAILABLE_MESSAGE);
    }
    await writeText(text);
  },
};

function resolveNavigatorClipboardMethod(method: 'readText'): (() => Promise<string>) | null;
function resolveNavigatorClipboardMethod(
  method: 'writeText',
): ((text: string) => Promise<void>) | null;
function resolveNavigatorClipboardMethod(
  method: 'readText' | 'writeText',
): (() => Promise<string>) | ((text: string) => Promise<void>) | null {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    return null;
  }
  const clipboardMethod = navigator.clipboard[method];
  return typeof clipboardMethod === 'function' ? clipboardMethod.bind(navigator.clipboard) : null;
}
