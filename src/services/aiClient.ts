import { fetch as fetchWithTauri } from '@tauri-apps/plugin-http';

import type { AiSettings } from '@/stores/appSettingsStore';

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SendAiChatOptions {
  fetcher?: typeof fetch;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export class AiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiClientError';
  }
}

export async function sendAiChat(
  settings: AiSettings,
  messages: AiChatMessage[],
  options: SendAiChatOptions | typeof fetch = {},
): Promise<string> {
  const normalizedOptions = typeof options === 'function' ? { fetcher: options } : options;
  const fetcher = normalizedOptions.fetcher ?? resolveDefaultFetcher();
  validateSettings(settings);
  return settings.provider === 'anthropic'
    ? sendAnthropicChat(settings, messages, fetcher, normalizedOptions)
    : sendOpenAiCompatibleChat(settings, messages, fetcher, normalizedOptions);
}

function resolveDefaultFetcher(): typeof fetch {
  const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  return isTauriRuntime ? fetchWithTauri : fetch;
}

function validateSettings(settings: AiSettings): void {
  if (settings.provider === 'none') {
    throw new AiClientError('Configure an AI provider in Settings first.');
  }
  if (!settings.model.trim()) {
    throw new AiClientError('Configure an AI model in Settings first.');
  }
  if (!settings.baseUrl.trim()) {
    throw new AiClientError('Configure an AI base URL in Settings first.');
  }
  if (settings.provider !== 'local' && !settings.token.trim()) {
    throw new AiClientError('Configure an AI authentication token in Settings first.');
  }
}

async function sendOpenAiCompatibleChat(
  settings: AiSettings,
  messages: AiChatMessage[],
  fetcher: typeof fetch,
  options: SendAiChatOptions,
): Promise<string> {
  const response = await fetcher(joinUrl(settings.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: buildOpenAiCompatibleHeaders(settings),
    signal: options.signal,
    body: JSON.stringify({
      model: settings.model,
      messages,
      reasoning_effort: settings.reasoningEffort,
      temperature: 0.2,
      stream: settings.streamingEnabled,
    }),
  });
  if (settings.streamingEnabled) {
    return readAiEventStream(response, options.onDelta, readOpenAiDelta);
  }
  const payload = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new AiClientError(payload?.error?.message ?? `AI request failed: ${response.status}`);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new AiClientError('AI response did not include a message.');
  }
  return content;
}

async function sendAnthropicChat(
  settings: AiSettings,
  messages: AiChatMessage[],
  fetcher: typeof fetch,
  options: SendAiChatOptions,
): Promise<string> {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const chatMessages = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: message.content }));

  const response = await fetcher(joinUrl(settings.baseUrl, '/v1/messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': settings.token,
    },
    signal: options.signal,
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1024,
      system: systemMessages || undefined,
      messages: chatMessages,
      output_config: { effort: settings.reasoningEffort },
      stream: settings.streamingEnabled,
    }),
  });
  if (settings.streamingEnabled) {
    return readAiEventStream(response, options.onDelta, readAnthropicDelta);
  }
  const payload = (await response.json().catch(() => null)) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new AiClientError(payload?.error?.message ?? `AI request failed: ${response.status}`);
  }
  const content = payload?.content
    ?.filter((item) => item.type === 'text' && item.text)
    .map((item) => item.text)
    .join('\n');
  if (!content) {
    throw new AiClientError('AI response did not include text content.');
  }
  return content;
}

async function readAiEventStream(
  response: Response,
  onDelta: ((delta: string) => void) | undefined,
  readDelta: (payload: unknown) => string,
): Promise<string> {
  if (!response.ok) {
    throw new AiClientError(await readResponseError(response));
  }
  if (!response.body) {
    throw new AiClientError('AI response did not include a readable stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const result = drainSseBuffer(buffer, (eventData) => {
      if (eventData === '[DONE]') {
        return;
      }
      const payload = parseJsonEvent(eventData);
      const delta = readDelta(payload);
      if (!delta) {
        return;
      }
      content += delta;
      onDelta?.(delta);
    });
    buffer = result.remaining;
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    drainSseBuffer(`${buffer}\n\n`, (eventData) => {
      if (eventData === '[DONE]') {
        return;
      }
      const delta = readDelta(parseJsonEvent(eventData));
      if (delta) {
        content += delta;
        onDelta?.(delta);
      }
    });
  }

  if (!content) {
    throw new AiClientError('AI response did not include text content.');
  }
  return content;
}

function drainSseBuffer(
  buffer: string,
  onEventData: (eventData: string) => void,
): { remaining: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const remaining = parts.pop() ?? '';
  for (const part of parts) {
    const eventData = part
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (eventData) {
      onEventData(eventData);
    }
  }
  return { remaining };
}

function parseJsonEvent(eventData: string): unknown {
  try {
    const payload = JSON.parse(eventData) as { error?: { message?: string } };
    if (payload.error?.message) {
      throw new AiClientError(payload.error.message);
    }
    return payload;
  } catch (error) {
    if (error instanceof AiClientError) {
      throw error;
    }
    throw new AiClientError('AI stream returned invalid event data.');
  }
}

function readOpenAiDelta(payload: unknown): string {
  const data = payload as { choices?: Array<{ delta?: { content?: string } }> };
  return data.choices?.[0]?.delta?.content ?? '';
}

function readAnthropicDelta(payload: unknown): string {
  const data = payload as {
    delta?: { text?: string; type?: string };
    type?: string;
  };
  if (data.type !== 'content_block_delta') {
    return '';
  }
  return data.delta?.text ?? '';
}

async function readResponseError(response: Response): Promise<string> {
  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: { message?: string } } | null;
  if (payload?.error?.message) {
    return payload.error.message;
  }
  return `AI request failed: ${response.status}`;
}

function buildOpenAiCompatibleHeaders(settings: AiSettings): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (settings.token.trim()) {
    const headerName = settings.tokenHeaderName.trim() || 'Authorization';
    const prefix = settings.tokenPrefix.trim();
    headers[headerName] = prefix ? `${prefix} ${settings.token}` : settings.token;
  }
  return headers;
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return path.startsWith('/v1/') && normalizedBase.endsWith('/v1')
    ? `${normalizedBase}${path.slice(3)}`
    : `${normalizedBase}${path}`;
}
