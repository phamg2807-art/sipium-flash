/**
 * Parsing AI output safely.
 *
 * Models occasionally wrap JSON in prose or emit near-JSON. We never write
 * unvalidated model output to the database: the caller validates the parsed
 * value against a zod schema afterwards.
 */

/** Strip markdown fences and locate the first JSON value in a blob of text. */
export function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace === -1) return null;

  const open = trimmed[firstBrace];
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return trimmed.slice(firstBrace, i + 1);
    }
  }

  // Unbalanced (truncated) output — fall through to repair.
  return trimmed.slice(firstBrace) + (open === '{' ? close : close);
}

/**
 * Conservative repairs: trailing commas, smart quotes, single-quoted strings,
 * JS-style comments, and a truncated tail. Anything riskier is rejected so the
 * caller can retry instead of guessing.
 */
export function repairJson(input: string): string {
  let out = input
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/^\s*\/\/[^\n]*\n/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  // Balance brackets by dropping an incomplete trailing element.
  const balance = (open: string, close: string) => {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < out.length; i += 1) {
      const ch = out[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth += 1;
      else if (ch === close) depth -= 1;
    }
    return depth;
  };

  let guard = 0;
  while (balance('{', '}') > 0 && guard < 200) {
    // Cut back to the last complete element before appending the closer.
    const lastComma = out.lastIndexOf(',');
    const lastColon = out.lastIndexOf(':');
    const cut = Math.max(lastComma, lastColon);
    if (cut === -1) break;
    out = out.slice(0, cut);
    guard += 1;
  }
  while (balance('{', '}') > 0 && guard < 220) {
    out += '}';
    guard += 1;
  }
  guard = 0;
  while (balance('[', ']') > 0 && guard < 220) {
    out += ']';
    guard += 1;
  }

  return out;
}

export interface ParseResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
  repaired: boolean;
}

/** Try progressively harder to obtain a JSON value from model output. */
export function parseJsonLoose<T = unknown>(text: string): ParseResult<T> {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return { ok: false, error: 'No JSON found in model output', repaired: false };

  try {
    return { ok: true, value: JSON.parse(candidate) as T, repaired: false };
  } catch {
    // fall through to repair
  }

  try {
    const repaired = repairJson(candidate);
    return { ok: true, value: JSON.parse(repaired) as T, repaired: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unparseable JSON',
      repaired: true,
    };
  }
}

/** Small helper: coerce model output into an array, tolerating wrapper objects. */
export function asArray(value: unknown, preferredKeys = ['cards', 'items', 'data', 'results', 'words']): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of preferredKeys) {
      const nested = (value as Record<string, unknown>)[key];
      if (Array.isArray(nested)) return nested;
    }
  }
  return [];
}
