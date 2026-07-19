import { describe, expect, it, vi } from 'vitest';

import { sendAiChat } from './aiClient';

describe('sendAiChat', () => {
  it('sends OpenAI-compatible requests with bearer authentication', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'ok' } }] }));

    const answer = await sendAiChat(
      {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-test',
        token: 'token-a',
        tokenHeaderName: 'Authorization',
        tokenPrefix: 'Bearer',
        streamingEnabled: false,
        contextEnabled: false,
        includeWorkingDirectory: true,
        commandPolicy: 'ask',
      },
      [{ role: 'user', content: 'hello' }],
      fetcher as unknown as typeof fetch,
    );

    expect(answer).toBe('ok');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
      }),
    );
  });

  it('sends Anthropic requests with x-api-key authentication', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ content: [{ type: 'text', text: 'anthropic ok' }] }),
    );

    await sendAiChat(
      {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-test',
        token: 'token-b',
        tokenHeaderName: 'x-api-key',
        tokenPrefix: '',
        streamingEnabled: false,
        contextEnabled: true,
        includeWorkingDirectory: true,
        commandPolicy: 'suggest',
      },
      [
        { role: 'system', content: 'be useful' },
        { role: 'user', content: 'hello' },
      ],
      fetcher as unknown as typeof fetch,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          'anthropic-version': '2023-06-01',
          'x-api-key': 'token-b',
        }),
      }),
    );
  });

  it('streams OpenAI-compatible response deltas', async () => {
    const fetcher = vi.fn(async () =>
      streamResponse(
        [
          'data: {"choices":[{"delta":{"content":"hel"}}]}',
          '',
          'data: {"choices":[{"delta":{"content":"lo"}}]}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
      ),
    );
    const deltas: string[] = [];

    const answer = await sendAiChat(
      {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-test',
        token: 'token-a',
        tokenHeaderName: 'Authorization',
        tokenPrefix: 'Bearer',
        streamingEnabled: true,
        contextEnabled: false,
        includeWorkingDirectory: true,
        commandPolicy: 'ask',
      },
      [{ role: 'user', content: 'hello' }],
      { fetcher: fetcher as unknown as typeof fetch, onDelta: (delta) => deltas.push(delta) },
    );

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({ stream: true });
    expect(deltas).toEqual(['hel', 'lo']);
    expect(answer).toBe('hello');
  });

  it('streams Anthropic response deltas', async () => {
    const fetcher = vi.fn(async () =>
      streamResponse(
        [
          'event: content_block_delta',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
          '',
          'event: message_stop',
          'data: {"type":"message_stop"}',
          '',
        ].join('\n'),
      ),
    );
    const deltas: string[] = [];

    const answer = await sendAiChat(
      {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-test',
        token: 'token-b',
        tokenHeaderName: 'x-api-key',
        tokenPrefix: '',
        streamingEnabled: true,
        contextEnabled: true,
        includeWorkingDirectory: true,
        commandPolicy: 'suggest',
      },
      [{ role: 'user', content: 'hello' }],
      { fetcher: fetcher as unknown as typeof fetch, onDelta: (delta) => deltas.push(delta) },
    );

    expect(deltas).toEqual(['hi']);
    expect(answer).toBe('hi');
  });
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

function streamResponse(content: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    }),
    { status: 200 },
  );
}
