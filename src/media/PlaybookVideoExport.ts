/**
 * Records a short clip of a canvas (the playbook preview) to a downloadable video file.
 * Uses `HTMLCanvasElement.captureStream` + `MediaRecorder`, both native browser APIs — no
 * extra dependency, and no server round-trip. Resolves `null` if the browser can't do it
 * (older Safari lacks `captureStream`), so callers can show a friendly fallback message.
 */
export async function recordCanvasToVideo(
  canvas: HTMLCanvasElement,
  durationMs: number,
  fps: number,
): Promise<Blob | null> {
  type CapturableCanvas = HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };
  const captureStream = (canvas as CapturableCanvas).captureStream;
  if (typeof captureStream !== 'function' || typeof MediaRecorder === 'undefined') return null;

  const stream = captureStream.call(canvas, fps);
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(
    (type) => MediaRecorder.isTypeSupported?.(type),
  );
  if (!mimeType) return null;

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  return new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => resolve(null);
    recorder.start();
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, durationMs);
  });
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
