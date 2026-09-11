export type ChatRole = 'system' | 'user' | 'assistant';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
}

export interface CompleteOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for strict JSON output when it supports it. */
  jsonMode?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AiProvider {
  id: 'xkiro' | 'minimax' | 'offline';
  label: string;
  model: string;
  /** False for the deterministic offline engine. */
  configured: boolean;
  vision: boolean;
  describe(): { id: string; label: string; model: string; configured: boolean; vision: boolean };
  complete(options: CompleteOptions): Promise<string>;
  health(): Promise<{ ok: boolean; detail?: string; latencyMs: number }>;
}
