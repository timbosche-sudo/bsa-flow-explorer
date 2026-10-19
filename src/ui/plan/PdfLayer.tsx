/**
 * Draws the PDF drawing beneath all overlays. A full-page overview bitmap is
 * drawn immediately for every view change; once the view settles, the visible
 * region is re-rendered at screen resolution so linework stays sharp at any
 * zoom. The drawing is placed by sheet->world (calibration) composed with the
 * view transform, so it never stretches or distorts.
 */
import { useEffect, useRef } from 'react';
import { useView } from '@/store/viewStore';
import { useDrawing } from '@/store/drawingStore';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { affineScale, apply, compose, invert, sheetToWorld, type Affine } from '@/geometry/calibration';
import { renderOverview, renderRegion, type RegionRender } from '@/services/pdf';
import type { RenderTask } from 'pdfjs-dist';

const MAX_REGION_PX = 5000 * 4000;

export function PdfLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const overview = useRef<RegionRender | null>(null);
  const detail = useRef<RegionRender | null>(null);
  const task = useRef<RenderTask | null>(null);
  const timer = useRef<number>(0);
  const page = useDrawing((s) => s.page);
  const version = useDrawing((s) => s.version);
  const cal = useProject((s) => s.project!.calibration);
  const fp = useProject((s) => s.project!.floorPlan);
  const layer = useUI((s) => s.layers.floorPlan);

  // Render overview whenever the page changes.
  useEffect(() => {
    overview.current = null;
    detail.current = null;
    if (!page) return draw();
    const r = renderOverview(page);
    let cancelled = false;
    r.promise
      .then((res) => {
        if (cancelled) return;
        overview.current = res;
        draw();
        scheduleDetail();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      r.task.cancel();
    };
  }, [page, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheetToScreen = (): Affine => {
    const v = useView.getState();
    return compose({ a: v.scale, b: 0, c: 0, d: v.scale, e: v.tx, f: v.ty }, sheetToWorld(cal));
  };

  function draw() {
    const canvas = ref.current;
    if (!canvas) return;
    const { width, height } = useView.getState();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!layer.visible || !fp.visible) return;
    const s2s = sheetToScreen();
    // Paper sheet background with subtle shadow.
    ctx.save();
    ctx.setTransform(dpr * s2s.a, dpr * s2s.b, dpr * s2s.c, dpr * s2s.d, dpr * s2s.e, dpr * s2s.f);
    ctx.shadowColor = 'rgba(0,0,0,0.10)';
    ctx.shadowBlur = 12 * dpr;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 0, fp.pageWidth, fp.pageHeight);
    ctx.restore();
    ctx.globalAlpha = fp.opacity * layer.opacity;
    if (fp.muted) ctx.filter = 'grayscale(1) contrast(0.75) brightness(1.08)';
    ctx.imageSmoothingQuality = 'high';
    for (const r of [overview.current, detail.current]) {
      if (!r) continue;
      const m = compose(s2s, { a: 1 / r.pxPerUnit, b: 0, c: 0, d: 1 / r.pxPerUnit, e: r.x0, f: r.y0 });
      ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.e, dpr * m.f);
      ctx.drawImage(r.canvas, 0, 0);
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }

  function scheduleDetail() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(renderDetail, 160);
  }

  function renderDetail() {
    if (!page || !overview.current) return;
    const { width, height } = useView.getState();
    const dpr = window.devicePixelRatio || 1;
    const s2s = sheetToScreen();
    const need = affineScale(s2s) * dpr; // device px per sheet unit
    if (need <= overview.current.pxPerUnit * 1.05) {
      detail.current = null;
      draw();
      return;
    }
    // Visible sheet rectangle.
    const inv = invert(s2s);
    const corners = [
      apply(inv, { x: 0, y: 0 }),
      apply(inv, { x: width, y: 0 }),
      apply(inv, { x: 0, y: height }),
      apply(inv, { x: width, y: height }),
    ];
    const x0 = Math.max(0, Math.min(...corners.map((c) => c.x)));
    const y0 = Math.max(0, Math.min(...corners.map((c) => c.y)));
    const x1 = Math.min(fp.pageWidth, Math.max(...corners.map((c) => c.x)));
    const y1 = Math.min(fp.pageHeight, Math.max(...corners.map((c) => c.y)));
    if (x1 <= x0 || y1 <= y0) return;
    let px = need;
    const areaPx = (x1 - x0) * (y1 - y0) * px * px;
    if (areaPx > MAX_REGION_PX) px = Math.sqrt(MAX_REGION_PX / ((x1 - x0) * (y1 - y0)));
    task.current?.cancel();
    const r = renderRegion(page, x0, y0, x1 - x0, y1 - y0, px);
    task.current = r.task;
    r.promise
      .then((res) => {
        detail.current = res;
        draw();
      })
      .catch(() => {});
  }

  // Redraw on view changes and schedule a sharp re-render.
  useEffect(() => {
    draw();
    const unsub = useView.subscribe(() => {
      draw();
      scheduleDetail();
    });
    return () => {
      unsub();
      window.clearTimeout(timer.current);
    };
  }); // re-bind each render so closures see current calibration/settings

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
