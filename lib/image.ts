'use client';

import type { ImagePayload } from '@/shared/types';

const MAX_DIMENSION = 1600;
const QUALITY = 0.86;

async function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be read.'));
    image.src = source;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale and re-encode an image before it leaves the browser keeps requests
 * small and the AI call fast.
 */
export async function compressToPayload(file: Blob, name?: string): Promise<ImagePayload> {
  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return { data: dataUrl.split(',')[1] ?? dataUrl, mimeType: file.type || 'image/png', name };
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const encoded = canvas.toDataURL('image/jpeg', QUALITY);
  return {
    data: encoded.split(',')[1] ?? encoded,
    mimeType: 'image/jpeg',
    name,
  };
}

export function payloadToPreview(payload: ImagePayload): string {
  return payload.data.startsWith('data:') ? payload.data : `data:${payload.mimeType};base64,${payload.data}`;
}

export function isImagePayloadSupported(file: File): boolean {
  return /^image\/(png|jpeg|jpg|webp|gif|bmp)$/i.test(file.type);
}

/** Extract image files from a paste or drop event. */
export function imagesFromClipboard(items: DataTransferItemList | null): File[] {
  const files: File[] = [];
  if (!items) return files;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && isImagePayloadSupported(file)) files.push(file);
  }
  return files;
}
