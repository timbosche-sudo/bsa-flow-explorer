/**
 * PDF.js integration. Drawings are rendered locally (no network access is
 * needed for user files). Sheet coordinates are those of the page viewport at
 * scale 1 (points, y down), including the page's intrinsic /Rotate.
 */
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

export async function openPdf(data: ArrayBuffer | Uint8Array | string): Promise<PDFDocumentProxy> {
  const src = typeof data === 'string' ? { url: data } : { data: data instanceof Uint8Array ? data : new Uint8Array(data) };
  return pdfjs.getDocument({ ...src, isEvalSupported: false }).promise;
}

export function pageSize(page: PDFPageProxy): { width: number; height: number } {
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

export interface RegionRender {
  canvas: HTMLCanvasElement;
  /** Sheet-space rectangle covered by the canvas. */
  x0: number;
  y0: number;
  /** Device pixels per sheet unit. */
  pxPerUnit: number;
}

/**
 * Render a rectangular sheet region at a given resolution. Returns a canvas
 * whose pixel (0,0) corresponds to sheet point (x0, y0).
 */
export function renderRegion(
  page: PDFPageProxy,
  x0: number,
  y0: number,
  w: number,
  h: number,
  pxPerUnit: number,
): { task: RenderTask; promise: Promise<RegionRender> } {
  const viewport = page.getViewport({ scale: pxPerUnit });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * pxPerUnit));
  canvas.height = Math.max(1, Math.ceil(h * pxPerUnit));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -x0 * pxPerUnit, -y0 * pxPerUnit],
    background: 'rgba(255,255,255,1)',
  });
  return { task, promise: task.promise.then(() => ({ canvas, x0, y0, pxPerUnit })) };
}

/** Render the whole page with its longest side at `maxPx` device pixels. */
export function renderOverview(page: PDFPageProxy, maxPx = 3072) {
  const { width, height } = pageSize(page);
  const s = maxPx / Math.max(width, height);
  return renderRegion(page, 0, 0, width, height, s);
}
