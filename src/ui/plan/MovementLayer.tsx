/**
 * Animated staff markers and trajectories, drawn imperatively on a canvas.
 * React never renders individual observations: this layer subscribes to the
 * playback clock and view transform and redraws on every frame.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { ID, SimActivitySpan, Track, Vec2 } from '@/domain/types';
import { clock, usePlayback } from '@/store/playback';
import { useView } from '@/store/viewStore';
import { useUI } from '@/store/uiStore';
import { useProject } from '@/store/projectStore';
import { useActiveDataset } from '@/store/dataStore';
import { indexAtOrBefore, positionAt } from '@/analytics/trackUtils';
import { useSpatialContext } from '@/store/derived';

interface Decimated {
  /** Sample indices kept after removing stationary repeats. */
  idx: Int32Array;
}

/** Drop consecutive samples closer than `eps` meters (stationary noise) — rendering only. */
function decimate(tr: Track, eps = 0.08): Decimated {
  const out: number[] = [];
  let lx = NaN;
  let ly = NaN;
  for (let i = 0; i < tr.t.length; i++) {
    const g = tr.gap[i];
    if (g || i === 0 || i === tr.t.length - 1 || Math.hypot(tr.x[i] - lx, tr.y[i] - ly) >= eps) {
      out.push(i);
      lx = tr.x[i];
      ly = tr.y[i];
    }
  }
  return { idx: Int32Array.from(out) };
}

export function MovementLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const ds = useActiveDataset();
  const roles = useProject((s) => s.project!.roles);
  const staffDefs = useProject((s) => s.project!.staff);
  const layers = useUI((s) => s.layers);
  const trails = useUI((s) => s.trails);
  const markers = useUI((s) => s.markers);
  const roleFilter = useUI((s) => s.roleFilter);
  const staffFilter = useUI((s) => s.staffFilter);
  const selection = useUI((s) => s.selection);
  const rangeStart = usePlayback((s) => s.rangeStart);
  const rangeEnd = usePlayback((s) => s.rangeEnd);
  const ctxSpatial = useSpatialContext();

  const decimated = useMemo(() => new Map((ds?.tracks ?? []).map((t) => [t.staffId, decimate(t)])), [ds]);
  const spansByStaff = useMemo(() => {
    const m = new Map<ID, SimActivitySpan[]>();
    for (const s of ds?.spans ?? []) {
      if (!m.has(s.staffId)) m.set(s.staffId, []);
      m.get(s.staffId)!.push(s);
    }
    return m;
  }, [ds]);

  const hints = useRef(new Map<ID, number>());
  const state = useRef({ ds, roles, staffDefs, layers, trails, markers, roleFilter, staffFilter, selection, rangeStart, rangeEnd, decimated, spansByStaff, ctxSpatial });
  state.current = { ds, roles, staffDefs, layers, trails, markers, roleFilter, staffFilter, selection, rangeStart, rangeEnd, decimated, spansByStaff, ctxSpatial };

  useEffect(() => {
    let raf = 0;
    const request = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), draw()));
    };
    const draw = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const v = useView.getState();
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(v.width * dpr);
      const H = Math.round(v.height * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const g = canvas.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      const s = state.current;
      if (!s.ds) return;
      const t = clock.t;
      const roleColor = new Map(s.roles.map((r) => [r.id, r.color]));
      const code = new Map(s.staffDefs.map((m) => [m.id, m.code]));
      const selectedStaff = s.selection?.kind === 'staff' ? s.selection.id : null;
      const selectedRole = s.selection?.kind === 'role' ? s.selection.id : null;
      const active = (tr: Track) =>
        (!s.roleFilter.length || s.roleFilter.includes(tr.roleId ?? '')) && (!s.staffFilter.length || s.staffFilter.includes(tr.staffId));
      const emphasis = (tr: Track) => {
        if (!active(tr)) return 0.12;
        if (selectedStaff) return tr.staffId === selectedStaff ? 1 : 0.25;
        if (selectedRole) return tr.roleId === selectedRole ? 1 : 0.25;
        return 1;
      };
      const S = (x: number, y: number) => [(x * v.scale + v.tx) * dpr, (y * v.scale + v.ty) * dpr] as const;

      // --- Trails --------------------------------------------------------------
      if (s.layers.trails.visible && s.trails.mode !== 'off') {
        g.lineCap = 'round';
        g.lineJoin = 'round';
        for (const tr of s.ds.tracks) {
          const em = emphasis(tr);
          if (em < 0.2 && s.trails.mode !== 'full') continue;
          const color = roleColor.get(tr.roleId ?? '') ?? '#6b6f76';
          const dec = s.decimated.get(tr.staffId);
          if (!dec) continue;
          let tFrom: number;
          let tTo: number;
          if (s.trails.mode === 'tail') {
            tFrom = Math.max(s.rangeStart, t - s.trails.tailMinutes * 60);
            tTo = t;
          } else if (s.trails.mode === 'buildup') {
            tFrom = s.rangeStart;
            tTo = t;
          } else {
            tFrom = s.rangeStart;
            tTo = s.rangeEnd;
          }
          if (tTo <= tFrom) continue;
          const pts = collect(tr, dec, tFrom, tTo);
          if (pts.length < 2) continue;
          g.strokeStyle = color;
          g.lineWidth = s.trails.width * dpr * (tr.staffId === selectedStaff ? 1.6 : 1);
          const baseAlpha = s.layers.trails.opacity * s.trails.opacity * em;
          const fade = s.trails.fade && s.trails.mode !== 'full';
          const chunks = fade ? 8 : 1;
          for (let c = 0; c < chunks; c++) {
            const a = Math.floor((c * (pts.length - 1)) / chunks);
            const b = Math.floor(((c + 1) * (pts.length - 1)) / chunks);
            g.globalAlpha = baseAlpha * (fade ? 0.12 + (0.88 * (c + 1)) / chunks : 1);
            g.beginPath();
            for (let k = a; k <= b; k++) {
              const p = pts[k];
              const [sx, sy] = S(p.x, p.y);
              if (k === a || p.gap) g.moveTo(sx, sy);
              else g.lineTo(sx, sy);
            }
            g.stroke();
          }
          if (s.trails.arrows) drawArrows(g, pts, S, color, baseAlpha, dpr, v.scale);
          if (s.trails.showLabels && pts.length) {
            const last = pts[pts.length - 1];
            const [sx, sy] = S(last.x, last.y);
            g.globalAlpha = baseAlpha;
            g.font = `${10 * dpr}px Inter Variable, sans-serif`;
            g.fillStyle = color;
            g.fillText(code.get(tr.staffId) ?? '', sx + 8 * dpr, sy + 12 * dpr);
          }
        }
        g.globalAlpha = 1;
      }

      // --- Markers --------------------------------------------------------------
      if (!s.layers.staff.visible) return;
      const R = 5.5 * dpr;
      const ordered = [...s.ds.tracks].sort((a, b) => emphasis(a) - emphasis(b));
      for (const tr of ordered) {
        const pos = positionAt(tr, t, hints.current.get(tr.staffId) ?? -1);
        if (!pos) continue;
        hints.current.set(tr.staffId, pos.index);
        const em = emphasis(tr);
        const color = roleColor.get(tr.roleId ?? '') ?? '#6b6f76';
        const [sx, sy] = S(pos.p.x, pos.p.y);
        const sel = tr.staffId === selectedStaff;
        g.globalAlpha = Math.max(0.15, em) * s.layers.staff.opacity;

        // Destination (simulation ground truth only).
        if (s.markers.destination && s.ds.meta.kind === 'simulated' && (sel || !selectedStaff)) {
          const span = currentSpan(s.spansByStaff.get(tr.staffId), t);
          if (span?.kind === 'walk' && span.roomId) {
            const ap = s.ctxSpatial.activityPoint.get(span.roomId);
            if (ap) {
              const [dx, dy] = S(ap.x, ap.y);
              g.setLineDash([3 * dpr, 3 * dpr]);
              g.strokeStyle = color;
              g.lineWidth = 1.2 * dpr;
              g.beginPath();
              g.moveTo(sx, sy);
              g.lineTo(dx, dy);
              g.stroke();
              g.setLineDash([]);
              g.beginPath();
              g.arc(dx, dy, 3 * dpr, 0, Math.PI * 2);
              g.stroke();
            }
          }
        }
        if (sel) {
          g.beginPath();
          g.arc(sx, sy, R * 2.3, 0, Math.PI * 2);
          g.fillStyle = color;
          g.globalAlpha = 0.16;
          g.fill();
          g.globalAlpha = 1;
        }
        // Direction indicator.
        if (s.markers.direction && pos.heading !== null && !pos.inGap) {
          const h = pos.heading;
          const tip = R * 2.1;
          g.beginPath();
          g.moveTo(sx + Math.cos(h) * tip, sy + Math.sin(h) * tip);
          g.lineTo(sx + Math.cos(h + 2.5) * R * 0.95, sy + Math.sin(h + 2.5) * R * 0.95);
          g.lineTo(sx + Math.cos(h - 2.5) * R * 0.95, sy + Math.sin(h - 2.5) * R * 0.95);
          g.closePath();
          g.fillStyle = color;
          g.fill();
        }
        g.beginPath();
        g.arc(sx, sy, sel ? R * 1.25 : R, 0, Math.PI * 2);
        if (pos.inGap) {
          // Position lost: hollow dashed marker at last known position.
          g.setLineDash([2 * dpr, 2 * dpr]);
          g.strokeStyle = color;
          g.lineWidth = 1.5 * dpr;
          g.fillStyle = '#ffffff';
          g.fill();
          g.stroke();
          g.setLineDash([]);
        } else {
          g.fillStyle = color;
          g.fill();
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.6 * dpr;
          g.stroke();
        }
        if (s.markers.labels && (em > 0.5 || sel)) {
          const label = code.get(tr.staffId) ?? tr.staffId;
          g.font = `600 ${(sel ? 11 : 9.5) * dpr}px Inter Variable, sans-serif`;
          const w = g.measureText(label).width;
          const lx = sx - w / 2;
          const ly = sy - R - 6 * dpr;
          g.lineWidth = 3 * dpr;
          g.strokeStyle = 'rgba(255,255,255,0.92)';
          g.strokeText(label, lx, ly);
          g.fillStyle = '#1d2327';
          g.fillText(label, lx, ly);
        }
      }
      g.globalAlpha = 1;
    };

    draw();
    const u1 = clock.subscribe(request);
    const u2 = useView.subscribe(request);
    return () => {
      u1();
      u2();
      cancelAnimationFrame(raf);
    };
  }, []);

  // Redraw when settings change.
  useEffect(() => {
    const id = requestAnimationFrame(() => clock.set(clock.t));
    return () => cancelAnimationFrame(id);
  }, [ds, layers, trails, markers, roleFilter, staffFilter, selection, rangeStart, rangeEnd]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

type P = Vec2 & { gap: boolean };

function collect(tr: Track, dec: Decimated, tFrom: number, tTo: number): P[] {
  const out: P[] = [];
  const i0 = Math.max(0, indexAtOrBefore(tr.t, tFrom));
  const i1 = indexAtOrBefore(tr.t, tTo);
  if (i1 < 0) return out;
  // Binary search into decimated index list.
  let lo = 0;
  let hi = dec.idx.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (dec.idx[m] < i0) lo = m + 1;
    else hi = m;
  }
  const start = positionAt(tr, Math.max(tFrom, tr.t[0]), i0, Infinity);
  if (start) out.push({ ...start.p, gap: true });
  for (let k = lo; k < dec.idx.length && dec.idx[k] <= i1; k++) {
    const i = dec.idx[k];
    out.push({ x: tr.x[i], y: tr.y[i], gap: tr.gap[i] === 1 || (i > 0 && tr.t[i] - tr.t[i - 1] > 30) });
  }
  const end = positionAt(tr, tTo, i1, 30);
  if (end && !end.inGap) out.push({ ...end.p, gap: false });
  return out;
}

function currentSpan(spans: SimActivitySpan[] | undefined, t: number): SimActivitySpan | null {
  if (!spans?.length) return null;
  let lo = 0;
  let hi = spans.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (spans[m].startS <= t) lo = m;
    else hi = m - 1;
  }
  const s = spans[lo];
  return s.startS <= t && t <= s.endS ? s : null;
}

function drawArrows(
  g: CanvasRenderingContext2D,
  pts: P[],
  S: (x: number, y: number) => readonly [number, number],
  color: string,
  alpha: number,
  dpr: number,
  scale: number,
) {
  const spacingM = Math.max(2, 70 / scale);
  let acc = 0;
  g.fillStyle = color;
  g.globalAlpha = alpha;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    if (b.gap) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    acc += d;
    if (acc < spacingM || d < 0.05) continue;
    acc = 0;
    const [sx, sy] = S(b.x, b.y);
    const h = Math.atan2(b.y - a.y, b.x - a.x);
    const L = 6 * dpr;
    g.beginPath();
    g.moveTo(sx + Math.cos(h) * L, sy + Math.sin(h) * L);
    g.lineTo(sx + Math.cos(h + 2.6) * L, sy + Math.sin(h + 2.6) * L);
    g.lineTo(sx + Math.cos(h - 2.6) * L, sy + Math.sin(h - 2.6) * L);
    g.closePath();
    g.fill();
  }
}

export { currentSpan };
