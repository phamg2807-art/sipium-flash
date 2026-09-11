'use client';

import { useRef, useState } from 'react';
import type { ImagePayload } from '@/shared/types';
import { compressToPayload, imagesFromClipboard, isImagePayloadSupported, payloadToPreview } from '@/lib/image';
import { Button } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';

export function ImageInput({
  images,
  onChange,
  onPasteText,
}: {
  images: ImagePayload[];
  onChange: (images: ImagePayload[]) => void;
  onPasteText?: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const toast = useToast();

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const supported = files.filter(isImagePayloadSupported);
      if (supported.length === 0) {
        toast.push({ message: 'Only images can be added here (PNG, JPG, WEBP, GIF).', tone: 'error' });
        return;
      }
      const payloads = await Promise.all(supported.slice(0, 6 - images.length).map((file) => compressToPayload(file, file.name)));
      onChange([...images, ...payloads].slice(0, 6));
    } catch (error) {
      toast.push({ message: error instanceof Error ? error.message : 'That image could not be added.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`dropzone${dragActive ? ' dropzone--active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        void addFiles([...event.dataTransfer.files]);
      }}
      onPaste={(event) => {
        const files = imagesFromClipboard(event.clipboardData?.items ?? null);
        if (files.length > 0) {
          event.preventDefault();
          void addFiles(files);
          return;
        }
        const text = event.clipboardData?.getData('text/plain');
        if (text && onPasteText) onPasteText(text);
      }}
    >
      <div className="stack stack--sm">
        <div className="row" style={{ justifyContent: 'center' }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            multiple
            className="visually-hidden"
            onChange={(event) => {
              void addFiles([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          <Button variant="soft" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
            Upload image
          </Button>
          <span className="muted" style={{ fontSize: 12.5 }}>
            or paste (⌘/Ctrl + V), or drop here
          </span>
        </div>
        {images.length > 0 ? (
          <div className="thumb-strip" style={{ justifyContent: 'center', marginTop: 6 }}>
            {images.map((image, index) => (
              <span key={`${image.name ?? 'image'}-${index}`} className="thumb">
                <img src={payloadToPreview(image)} alt={image.name ?? `Image ${index + 1}`} />
                <button
                  type="button"
                  className="thumb__remove"
                  aria-label="Remove image"
                  onClick={() => onChange(images.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 12.5 }}>
            Textbook pages, vocabulary lists, handwritten notes, screenshots, worksheets…
          </span>
        )}
      </div>
    </div>
  );
}
