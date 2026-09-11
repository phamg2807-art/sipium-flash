import { config } from '../config';
import { ApiError, notConfigured, upstreamError, upstreamTimeout } from '../errors';
import { logger } from '../logger';
import type { AiProvider, ChatMessage, CompleteOptions, ContentPart } from './types';

function policy(
  id: AiProvider['id'],
  label: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  vision: boolean,
): AiProvider {
  const configured = Boolean(apiKey);

  const buildBody = (options: CompleteOptions) => {
    const body: Record<string, unknown> = {
      model,
      messages: options.messages.map((m) => ({ role: m.role, content: normaliseContent(m.content) })),
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4000,
      stream: false,
    };
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
      body.temperature = options.temperature ?? 0.1;
    }
    return body;
  };

  return {
    id,
    label,
    model,
    configured,
    vision,
    describe: () => ({ id, label, model, configured, vision }),

    async complete(options: CompleteOptions) {
      if (!configured) {
        throw notConfigured(`${label} is not configured on the server (missing API key).`);
      }
      const timeoutMs = options.timeoutMs ?? config.ai.requestTimeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort);

      const started = Date.now();
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            accept: 'application/json',
          },
          body: JSON.stringify(buildBody(options)),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await safeText(response);
          logger.error('ai provider error', { provider: id, status: response.status, detail: detail.slice(0, 800) });
          if (response.status === 401 || response.status === 403) {
            throw notConfigured(`${label} rejected the server credentials.`);
          }
          if (response.status === 404) {
            throw notConfigured(`${label} could not find model "${model}".`);
          }
          if (response.status === 408 || response.status === 504) {
            throw upstreamTimeout(`${label} took too long to respond.`);
          }
          throw upstreamError(`${label} could not complete that request.`, { status: response.status });
        }

        const payload = (await response.json().catch(() => null)) as unknown;
        const content = pickContent(payload);
        if (content === null) {
          logger.error('ai provider returned no content', { provider: id, payload: String(payload).slice(0, 800) });
          throw upstreamError(`${label} returned an empty response.`);
        }
        logger.debug('ai provider ok', { provider: id, ms: Date.now() - started, chars: content.length });
        return content;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw upstreamTimeout(`${label} took too long to respond. Nothing was lost — try again.`);
        }
        throw upstreamError(`${label} is unreachable right now.`, error);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }
    },

    async health() {
      const started = Date.now();
      if (!configured) {
        return { ok: false, detail: `${label} API key not configured`, latencyMs: 0 };
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(`${baseUrl}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        }).catch(() => null);
        clearTimeout(timer);
        if (!response || !response.ok) {
          return {
            ok: false,
            detail: response ? `models endpoint returned ${response.status}` : 'unreachable',
            latencyMs: Date.now() - started,
          };
        }
        return { ok: true, latencyMs: Date.now() - started };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : 'unknown',
          latencyMs: Date.now() - started,
        };
      }
    },
  };
}

function normaliseContent(content: string | ContentPart[]): string | ContentPart[] {
  return content;
}

async function safeText(response: { text: () => Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** Handles both OpenAI-style and MiniMax-style response envelopes. */
function pickContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, any>;

  if (typeof record.reply === 'string' && record.reply.length > 0) return record.reply;
  if (typeof record.text === 'string' && record.text.length > 0) return record.text;

  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    const message = choice?.message ?? choice?.delta ?? {};
    if (typeof message?.content === 'string' && message.content.length > 0) return message.content;
    if (typeof choice?.text === 'string' && choice.text.length > 0) return choice.text;
  }

  const data = record.data;
  if (data && typeof data === 'object') {
    const nested = pickContent(data);
    if (nested) return nested;
  }

  return null;
}

export const xkiroProvider = (): AiProvider =>
  policy('xkiro', 'xKiro', config.ai.xkiro.baseUrl, config.ai.xkiro.apiKey, config.ai.xkiro.model, true);

export const minimaxProvider = (): AiProvider =>
  policy(
    'minimax',
    'MiniMax M3',
    config.ai.minimax.baseUrl,
    config.ai.minimax.apiKey,
    config.ai.minimax.model,
    true,
  );

export { policy as createOpenAiCompatibleProvider };
