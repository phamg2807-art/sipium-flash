/**
 * Image intake: validation + understanding.
 */
import { z } from 'zod';
import type { GenerationOptions, ImagePayload } from '@shared/types';
import { config } from '../config';
import { badRequest, notConfigured, tooLarge } from '../errors';
import { aiHelpers } from '../ai/ai-helpers';
import { isConfigured } from '../ai/gateway';

const MAX_BYTES = config.limits.maxImageBytes;
const ALLOWED = /^image\/(png|jpeg|jpg|webp|gif|bmp)$/i;

export function validateImage(payload: ImagePayload): { dataUrl: string; bytes: number } {
  const mime = (payload.mimeType || '').toLowerCase();
  if (!ALLOWED.test(mime)) {
    throw badRequest('That file does not look like a supported image. Use PNG, JPG, WEBP or GIF.');
  }
  const raw = payload.data.includes(',') && payload.data.startsWith('data:') ? payload.data.split(',')[1] : payload.data;
  if (!raw || raw.length < 32) {
    throw badRequest('That image looks empty. Try uploading or pasting it again.');
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
    throw badRequest('That image data is not valid base64.');
  }
  const bytes = Math.floor((raw.length * 3) / 4) - (raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0);
  if (bytes > MAX_BYTES) {
    throw tooLarge(`That image is ${(bytes / 1_000_000).toFixed(1)} MB. Please keep images under ${Math.round(MAX_BYTES / 1_000_000)} MB.`);
  }
  const dataUrl = `data:${mime};base64,${raw}`;
  return { dataUrl, bytes };
}

export type { ImagePayload };

export async function analyzeImage(input: {
  image: ImagePayload;
  intent: string;
  options: Partial<GenerationOptions>;
}) {
  if (!isConfigured()) {
    throw notConfigured(
      'Image understanding needs an AI provider configured on the server. Paste the text instead, or add XKIRO_API_KEY / MINIMAX_API_KEY.',
    );
  }
  const { dataUrl, bytes } = validateImage(input.image);
  const analysis = await aiHelpers.analyzeImage({
    imageDataUrl: dataUrl,
    intent: input.intent,
    options: normaliseOptions(input.options),
  });
  return { analysis, bytes };
}

function normaliseOptions(options: Partial<GenerationOptions>): GenerationOptions {
  return {
    mode: options.mode ?? 'general',
    cardCount: options.cardCount ?? 20,
    difficulty: options.difficulty ?? 3,
    includeVietnamese: options.includeVietnamese ?? true,
    englishOnly: options.englishOnly ?? false,
    includeExamples: options.includeExamples ?? true,
    includeCollocations: options.includeCollocations ?? true,
    includePronunciation: options.includePronunciation ?? true,
    includeSynonyms: options.includeSynonyms ?? true,
    band: options.band ?? '',
    skill: options.skill ?? '',
    topic: options.topic ?? '',
    customInstruction: options.customInstruction ?? '',
  };
}

export const imageSummarySchema = z.object({
  kind: z.string(),
  text: z.string(),
  items: z.array(z.string()),
  topics: z.array(z.string()),
  language: z.string(),
  notes: z.string(),
});
