/**
 * Records a short clip of a canvas to a browser-supported downloadable video file.
 * Uses `HTMLCanvasElement.captureStream` + `MediaRecorder`, both native browser APIs — no
 * extra dependency, and no server round-trip. Resolves `null` if the browser can't do it
 * (older Safari lacks `captureStream`), so callers can show a friendly fallback message.
 */
export async function recordCanvasToVideo(
  canvas: HTMLCanvasElement,
  durationMs: number,
  fps: number,
  signal?: AbortSignal,
): Promise<Blob | null> {
  type CapturableCanvas = HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };
  const captureStream = (canvas as CapturableCanvas).captureStream;
  if (typeof captureStream !== 'function' || typeof MediaRecorder === 'undefined') return null;

  const stream = captureStream.call(canvas, fps);
  const mimeType = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=h264',
    'video/mp4',
  ].find((type) => MediaRecorder.isTypeSupported?.(type));
  if (!mimeType) {
    for (const track of stream.getTracks()) track.stop();
    return null;
  }

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  return new Promise((resolve) => {
    let cancelled = false;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (blob: Blob | null): void => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      for (const track of stream.getTracks()) track.stop();
      resolve(blob);
    };
    const onAbort = (): void => {
      cancelled = true;
      if (recorder.state === 'inactive') {
        finish(null);
      } else {
        recorder.stop();
      }
    };
    recorder.onstop = () =>
      finish(cancelled ? null : new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => finish(null);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    recorder.start();
    timeout = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, durationMs);
  });
}

export function videoFileExtension(blob: Blob): 'mp4' | 'webm' {
  return blob.type.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

/** Triggers a browser download for an in-memory blob — same pattern as the JSON play export. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
