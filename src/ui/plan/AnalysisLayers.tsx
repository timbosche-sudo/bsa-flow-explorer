/**
 * Analysis overlays: heatmap raster, congestion segments/encounters, and
 * origin–destination flows. All drawn on canvases in world space.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useView } from '@/store/viewStore';
import { useUI } from '@/store/uiStore';
import { useProject } from '@/store/projectStore';
import { useCongestion, useHeatmap, useAnalysis, getLocator } from '@/store/analysis';
import { useSpatialContext } from '@/store/derived';
import { useActiveDataset } from '@/store/dataStore';
import { displayValue, unitFor, type HeatGrid } from '@/analytics/heatmap';
import { rampCss, rampRGB, rgbStr, divergingRGB, divergingCss } from '@/ui/colormaps';
import { METRIC_DEFINITIONS } from '@/analytics/definitions';
import { sliceTrack } from '@/analytics/trackUtils';
import { buildOD } from '@/analytics/od';
import { fmtClock } from '@/ui/format';
import type { DiffResult } from './useDiffHeat';

function useCanvasDraw(draw: (g: CanvasRenderingContext2D, dpr: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fn = useRef(draw);
  fn.current = draw;
  useEffect(() => {
    const run = () => {
      const c = ref.current;
      if (!c) return;
      const v = useView.getState();
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(v.width * dpr);
      const H = Math.round(v.height * dpr);
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const g = c.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      fn.current(g, dpr);
    };
    run();
    return useView.subscribe(run);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

/** Render a heat grid into an offscreen canvas (one pixel per cell). */
export function heatBitmap(grid: HeatGrid, colorAt: (i: number) => [number, number, number, number] | null): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = grid.cols;
  c.height = grid.rows;
  const g = c.getContext('2d')!;
  const img = g.createImageData(grid.cols, grid.rows);
  for (let i = 0; i < grid.values.length; i++) {
    const col = colorAt(i);
    if (!col) continue;
    img.data[i * 4] = col[0];
    img.data[i * 4 + 1] = col[1];
    img.data[i * 4 + 2] = col[2];
    img.data[i * 4 + 3] = col[3];
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function drawGrid(g: CanvasRenderingContext2D, dpr: number, grid: HeatGrid, bmp: HTMLCanvasElement, alpha: number) {
  const v = useView.getState();
  g.save();
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.setTransform(dpr * v.scale * grid.cell, 0, 0, dpr * v.scale * grid.cell, dpr * (v.scale * grid.originX + v.tx), dpr * (v.scale * grid.originY + v.ty));
  g.drawImage(bmp, 0, 0);
  g.restore();
}

export function HeatmapLayer() {
  const heat = useHeatmap();
  const hm = useUI((s) => s.heatmap);
  const layer = useUI((s) => s.layers.heatmap);
  const bmp = useMemo(() => {
    if (!heat) return null;
    const { grid } = heat;
    const max = grid.max;
    return heatBitmap(grid, (i) => {
      const v = grid.values[i];
      if (v <= 0 || !grid.mask[i]) return null;
      const t = Math.pow(Math.min(1, (v / max) * hm.intensity), 0.6);
      if (t < 0.02) return null;
      const [r, g, b] = rampRGB(hm.gradient, t);
      return [r, g, b, Math.round(255 * Math.min(1, 0.25 + t * 0.85))];
    });
  }, [heat, hm.intensity, hm.gradient]);
  const ref = useCanvasDraw(
    (g, dpr) => {
      if (heat && bmp && layer.visible) drawGrid(g, dpr, heat.grid, bmp, layer.opacity);
    },
    [bmp, layer.visible, layer.opacity],
  );
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

export function DiffHeatLayer({ diff }: { diff: DiffResult | null }) {
  const layer = useUI((s) => s.layers.heatmap);
  const bmp = useMemo(() => {
    if (!diff) return null;
    return heatBitmap(diff.grid, (i) => {
      const v = diff.grid.values[i];
      if (!diff.grid.mask[i] || Math.abs(v) < diff.maxAbs * 0.03) return null;
      const t = v / diff.maxAbs;
      const [r, g, b] = divergingRGB(t);
      return [r, g, b, Math.round(255 * Math.min(1, 0.3 + Math.abs(t) * 0.8))];
    });
  }, [diff]);
  const ref = useCanvasDraw(
    (g, dpr) => {
      if (diff && bmp && layer.visible) drawGrid(g, dpr, diff.grid, bmp, layer.opacity);
    },
    [bmp, layer.visible, layer.opacity],
  );
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

export function HeatLegend() {
  const heat = useHeatmap();
  const hm = useUI((s) => s.heatmap);
  if (!heat) return null;
  const maxDisp = displayValue(heat.grid.max, heat.metric, hm.normalization, heat.grid.max, heat.staffHours);
  const defKey = { presence: 'heatPresence', movement: 'heatMovement', frequency: 'heatFrequency', encounters: 'heatEncounters' }[heat.metric];
  const title = { presence: 'Presence density', movement: 'Movement density', frequency: 'Circulation frequency', encounters: 'Encounter locations' }[heat.metric];
  const fmt = (v: number) => (hm.normalization === 'relative' ? `${Math.round(v * 100)}%` : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
  return (
    <LegendBox title={title} sub={hm.rolling ? `Rolling ${hm.rollingMinutes} min to ${fmtClock(heat.range[1])}` : `${fmtClock(heat.range[0])} – ${fmtClock(heat.range[1])}`}>
      <div className="h-2.5 w-full rounded-[2px]" style={{ background: rampCss(hm.gradient) }} />
      <div className="mt-0.5 flex justify-between text-[10px] text-muted tnum">
        <span>{fmt(0)}</span>
        <span>{fmt(maxDisp / 2)}</span>
        <span>{fmt(maxDisp)}</span>
      </div>
      <div className="mt-1 text-[10px] leading-snug text-ink-2">{unitFor(heat.metric, hm.normalization, heat.grid.cell)}</div>
      <div className="mt-1 text-[10px] leading-snug text-muted">{METRIC_DEFINITIONS[defKey]} Not a measure of congestion.</div>
    </LegendBox>
  );
}

export function DiffLegend({ diff, labelA, labelB }: { diff: DiffResult | null; labelA: string; labelB: string }) {
  if (!diff) return null;
  return (
    <LegendBox title="Difference in movement density" sub={`${labelB} minus ${labelA}`}>
      <div className="h-2.5 w-full rounded-[2px]" style={{ background: divergingCss() }} />
      <div className="mt-0.5 grid grid-cols-3 text-[10px] leading-tight text-muted">
        <span>More in A<br />{labelA}</span>
        <span className="text-center">no change</span>
        <span className="text-right">More in B<br />{labelB}</span>
      </div>
      <div className="mt-1 text-[10px] leading-snug text-muted">Both normalized per tracked staff-hour, so windows of different length or staffing are comparable.</div>
    </LegendBox>
  );
}

export function LegendBox({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto w-[260px] rounded-[4px] border border-line bg-paper/95 p-2.5 shadow-sm">
      <div className="text-[11.5px] font-semibold">{title}</div>
      {sub && <div className="mb-1.5 text-[10px] text-muted tnum">{sub}</div>}
      {children}
    </div>
  );
}

export function CongestionLayer() {
  const cong = useCongestion();
  const layer = useUI((s) => s.layers.congestion);
  const threshold = useUI((s) => s.congestionThreshold);
  const ref = useCanvasDraw(
    (g, dpr) => {
      if (!cong || !layer.visible) return;
      const v = useView.getState();
      const seg = cong.options.segmentM;
      const maxAbove = Math.max(1, ...cong.segments.map((s) => s.secondsAtOrAbove));
      g.globalAlpha = layer.opacity;
      for (const s of cong.segments) {
        if (s.peak < 2) continue;
        const x = ((s.cx - seg / 2) * v.scale + v.tx) * dpr;
        const y = ((s.cy - seg / 2) * v.scale + v.ty) * dpr;
        const w = seg * v.scale * dpr;
        const over = s.peak >= threshold;
        const t = over ? 0.35 + 0.65 * (s.secondsAtOrAbove / maxAbove) : 0.12 + 0.1 * (s.peak / threshold);
        g.fillStyle = rgbStr(rampRGB('warm', t));
        g.globalAlpha = layer.opacity * (over ? 0.85 : 0.45);
        g.fillRect(x + dpr, y + dpr, w - 2 * dpr, w - 2 * dpr);
        if (over && w > 18 * dpr) {
          g.globalAlpha = 1;
          g.fillStyle = '#ffffff';
          g.font = `600 ${10 * dpr}px Inter Variable, sans-serif`;
          g.textAlign = 'center';
          g.fillText(String(s.peak), x + w / 2, y + w / 2 + 3.5 * dpr);
        }
      }
      // Encounter points.
      g.globalAlpha = Math.min(1, layer.opacity * 0.9);
      g.fillStyle = '#1d2327';
      for (const e of cong.encounters) {
        g.beginPath();
        g.arc((e.x * v.scale + v.tx) * dpr, (e.y * v.scale + v.ty) * dpr, 1.6 * dpr, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    },
    [cong, layer.visible, layer.opacity, threshold],
  );
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

export function CongestionLegend() {
  const threshold = useUI((s) => s.congestionThreshold);
  const cong = useCongestion();
  if (!cong) return null;
  return (
    <LegendBox title="Circulation overlap" sub={`${cong.options.segmentM} m segments, sampled every ${cong.options.stepS} s`}>
      <div className="h-2.5 w-full rounded-[2px]" style={{ background: rampCss('warm') }} />
      <div className="mt-0.5 flex justify-between text-[10px] text-muted">
        <span>2 people</span>
        <span>≥ {threshold}: shade = time at/above</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-2">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink" /> Encounter (within 1.5 m)
      </div>
      <div className="mt-1 text-[10px] leading-snug text-muted">Numbers show peak simultaneous people. Observed overlap — not confirmed obstruction or operational congestion.</div>
    </LegendBox>
  );
}

/** Origin–destination flows between rooms; a selected relationship highlights its journeys. */
export function ODLayer() {
  const a = useAnalysis();
  const ds = useActiveDataset();
  const p = useProject((s) => s.project!);
  const ctx = useSpatialContext();
  const highlight = useUI((s) => s.odHighlight);
  const roles = p.roles;
  const od = useMemo(() => (a ? buildOD(a.trips, a.locator, 'room') : null), [a]);
  const sensitive = useMemo(() => new Set(p.spatial.rooms.filter((r) => r.sensitive).map((r) => r.id)), [p.spatial.rooms]);
  const ref = useCanvasDraw(
    (g, dpr) => {
      if (!od || !a || !ds) return;
      const v = useView.getState();
      const loc = getLocator(p.spatial);
      const typeOf = (id: string) => loc.spaces[loc.index.get(id) ?? -1]?.type;
      const S = (x: number, y: number) => [(x * v.scale + v.tx) * dpr, (y * v.scale + v.ty) * dpr] as const;
      if (highlight) {
        // Draw the actual journeys of the selected relationship.
        const trips = a.trips.filter((t) => typeOf(t.fromRoomId) === highlight.fromType && typeOf(t.toRoomId) === highlight.toType);
        g.lineWidth = 2 * dpr;
        g.lineJoin = 'round';
        for (const t of trips) {
          const tr = ds.tracks.find((x) => x.staffId === t.staffId);
          if (!tr) continue;
          const sl = sliceTrack(tr, t.start, t.end);
          g.strokeStyle = roles.find((r) => r.id === t.roleId)?.color ?? '#6b6f76';
          g.globalAlpha = 0.55;
          g.beginPath();
          for (let i = 0; i < sl.t.length; i++) {
            const [sx, sy] = S(sl.x[i], sl.y[i]);
            if (i === 0 || sl.gap[i]) g.moveTo(sx, sy);
            else g.lineTo(sx, sy);
          }
          g.stroke();
        }
        g.globalAlpha = 1;
        return;
      }
      // Aggregate flows as curved arcs (undirected weight by trip count).
      const pairs = new Map<string, { a: string; b: string; n: number }>();
      for (const c of od.cells.values()) {
        if (sensitive.has(c.from) || sensitive.has(c.to)) continue;
        const [x, y] = c.from < c.to ? [c.from, c.to] : [c.to, c.from];
        const k = `${x}|${y}`;
        const e = pairs.get(k) ?? { a: x, b: y, n: 0 };
        e.n += c.trips;
        pairs.set(k, e);
      }
      const max = Math.max(1, ...[...pairs.values()].map((e) => e.n));
      const list = [...pairs.values()].sort((x, y) => x.n - y.n);
      for (const e of list) {
        const pa = ctx.activityPoint.get(e.a);
        const pb = ctx.activityPoint.get(e.b);
        if (!pa || !pb) continue;
        const [x1, y1] = S(pa.x, pa.y);
        const [x2, y2] = S(pb.x, pb.y);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const bend = 0.18;
        const t = e.n / max;
        g.strokeStyle = rgbStr(rampRGB('blue', 0.35 + 0.65 * t));
        g.globalAlpha = 0.25 + 0.65 * t;
        g.lineWidth = (0.8 + 7 * t) * dpr;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x1, y1);
        g.quadraticCurveTo(mx - dy * bend, my + dx * bend, x2, y2);
        g.stroke();
      }
      g.globalAlpha = 1;
    },
    [od, a, ds, highlight, sensitive, ctx],
  );
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

export function ODLegend() {
  const highlight = useUI((s) => s.odHighlight);
  return (
    <LegendBox title={highlight ? `${highlight.fromType} → ${highlight.toType}` : 'Room-to-room travel'} sub={highlight ? 'Individual journeys, coloured by role' : 'Arc weight = number of trips (both directions)'}>
      <div className="text-[10px] leading-snug text-muted">{METRIC_DEFINITIONS.trip}</div>
    </LegendBox>
  );
}

