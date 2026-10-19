/**
 * Graphic, report and data exports.
 *
 * Graphic exports re-render the live floor-plan layers at a higher device
 * pixel ratio (so linework and heatmaps stay sharp), compose them onto one
 * canvas and add a title block with the mandatory dataset designation,
 * analysis window, filters, units and data-quality notes.
 */
import type { jsPDF } from 'jspdf';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { usePlayback, clock } from '@/store/playback';
import { useView } from '@/store/viewStore';
import { getActiveDataset, useData } from '@/store/dataStore';
import { analyzeCached, getLocator } from '@/store/analysis';
import { buildOD } from '@/analytics/od';
import { fmtClock, fmtDistance, fmtDistanceLong, fmtDuration, fmtPct } from '@/ui/format';
import { rampRGB, rgbStr } from '@/ui/colormaps';
import { FT_PER_M } from '@/geometry/calibration';
import { downloadBlob, safeFileName } from './projectLifecycle';

export interface GraphicOptions {
  /** Pixel multiplier relative to the on-screen size. */
  scale: number;
  title?: string;
  analysisLabel: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function datasetDesignation(): { label: string; tone: 'sim' | 'obs' | 'none' } {
  const ds = getActiveDataset(useData.getState());
  if (!ds) return { label: 'NO MOVEMENT DATA', tone: 'none' };
  if (ds.meta.kind === 'simulated') return { label: 'SIMULATED DATA — DEMONSTRATION ONLY', tone: 'sim' };
  if (ds.meta.synthetic) return { label: 'SYNTHETIC TEST DATA — NOT A FIELD RECORDING', tone: 'sim' };
  return { label: `OBSERVED DATA — ${ds.meta.name}`, tone: 'obs' };
}

export function qualityNotes(): string[] {
  const p = useProject.getState().project!;
  const ds = getActiveDataset(useData.getState());
  const notes: string[] = [];
  if (!p.calibration.calibrated) notes.push('Drawing scale not calibrated — distances are approximate.');
  if (ds?.meta.kind === 'simulated') notes.push('Movement is generated from hypothetical workflow assumptions; it is not measured evidence.');
  if (ds?.meta.kind === 'observed') {
    notes.push(ds.meta.positionAccuracyM == null ? 'Positional accuracy unknown.' : `Positional accuracy approx. ${ds.meta.positionAccuracyM} m.`);
    notes.push('Cleaned trajectories; filtering documented in dataset provenance.');
  }
  notes.push('Staff presence is not clinical room utilisation. Overlap is not confirmed congestion.');
  return notes;
}

function filtersLabel(): string {
  const p = useProject.getState().project!;
  const { roleFilter } = useUI.getState();
  if (!roleFilter.length) return 'All roles';
  return roleFilter.map((id) => p.roles.find((r) => r.id === id)?.shortName ?? id).join(', ');
}

/** Render the current floor plan view to a high-resolution canvas with a title block. */
export async function renderViewCanvas(o: GraphicOptions): Promise<HTMLCanvasElement> {
  const host = document.querySelector('[data-testid=floor-plan]') as HTMLElement | null;
  if (!host) throw new Error('Floor plan view is not mounted');
  const base = window.devicePixelRatio || 1;
  const k = Math.max(1, o.scale);
  Object.defineProperty(window, 'devicePixelRatio', { get: () => k, configurable: true });
  try {
    // Trigger redraws of all canvas layers at the new pixel ratio.
    useView.setState({ ...useView.getState() });
    clock.set(clock.t);
    await wait(900); // allow the sharp PDF re-render to complete
    const { width: W, height: H } = useView.getState();
    const band = Math.round(150 * k);
    const out = document.createElement('canvas');
    out.width = Math.round(W * k);
    out.height = Math.round(H * k) + band;
    const g = out.getContext('2d')!;
    g.fillStyle = '#ebe8e3';
    g.fillRect(0, 0, out.width, out.height);
    for (const el of Array.from(host.children)) {
      if (el instanceof HTMLCanvasElement) {
        g.drawImage(el, 0, 0, out.width, Math.round(H * k));
      } else if (el instanceof SVGSVGElement) {
        const img = await svgToImage(el, W, H);
        g.drawImage(img, 0, 0, out.width, Math.round(H * k));
      }
    }
    // Crop to the plan extents (plus margin) so exports are not mostly empty.
    const crop = planCrop(W, H);
    const cw = Math.round(crop.w * k);
    const ch = Math.round(crop.h * k);
    const final = document.createElement('canvas');
    final.width = Math.max(cw, Math.round(900 * k));
    final.height = ch + band;
    const f = final.getContext('2d')!;
    f.fillStyle = '#ebe8e3';
    f.fillRect(0, 0, final.width, final.height);
    f.drawImage(out, Math.round(crop.x * k), Math.round(crop.y * k), cw, ch, Math.round((final.width - cw) / 2), 0, cw, ch);
    drawTitleBlock(f, final.width, ch, band, k, o);
    return final;
  } finally {
    Object.defineProperty(window, 'devicePixelRatio', { get: () => base, configurable: true });
    useView.setState({ ...useView.getState() });
    clock.set(clock.t);
  }
}

function planCrop(W: number, H: number) {
  const p = useProject.getState().project!;
  const v = useView.getState();
  const pts = [...p.spatial.rooms.flatMap((r) => r.polygon), ...p.spatial.circulation.flatMap((c) => c.polygon)];
  if (!pts.length) return { x: 0, y: 0, w: W, h: H };
  const xs = pts.map((q) => q.x * v.scale + v.tx);
  const ys = pts.map((q) => q.y * v.scale + v.ty);
  const m = 0.06 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 40;
  const x0 = Math.max(0, Math.min(...xs) - m);
  const y0 = Math.max(0, Math.min(...ys) - m);
  const x1 = Math.min(W, Math.max(...xs) + m);
  const y1 = Math.min(H, Math.max(...ys) + m);
  return x1 - x0 < 200 || y1 - y0 < 150 ? { x: 0, y: 0, w: W, h: H } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

async function svgToImage(svg: SVGSVGElement, W: number, H: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(W));
  clone.setAttribute('height', String(H));
  clone.setAttribute('viewBox', `0 0 ${W} ${H}`);
  clone.setAttribute('font-family', 'Inter, Helvetica, Arial, sans-serif');
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('SVG layer could not be rendered'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function drawTitleBlock(g: CanvasRenderingContext2D, W: number, y0: number, band: number, k: number, o: GraphicOptions) {
  const p = useProject.getState().project!;
  const pb = usePlayback.getState();
  const des = datasetDesignation();
  const ui = useUI.getState();
  g.fillStyle = '#ffffff';
  g.fillRect(0, y0, W, band);
  g.fillStyle = '#e2dfda';
  g.fillRect(0, y0, W, Math.max(1, k));
  const pad = 22 * k;
  const font = (w: number, s: number) => `${w} ${s * k}px Inter Variable, Inter, Helvetica, Arial, sans-serif`;
  g.textBaseline = 'top';
  g.fillStyle = '#1d2327';
  g.font = font(600, 19);
  g.fillText(o.title || p.meta.name, pad, y0 + 18 * k);
  g.font = font(400, 12.5);
  g.fillStyle = '#3a4147';
  const sub = [p.meta.facilityName, p.meta.studyArea].filter(Boolean).join(' · ');
  g.fillText(sub || 'BSA Flow Explorer', pad, y0 + 44 * k);
  g.font = font(600, 12);
  g.fillStyle = '#1d2327';
  g.fillText(`${o.analysisLabel}`, pad, y0 + 70 * k);
  g.font = font(400, 11.5);
  g.fillStyle = '#6e7378';
  const win = `${fmtClock(pb.rangeStart)} – ${fmtClock(pb.rangeEnd)}${ui.heatmap.rolling ? ` (rolling ${ui.heatmap.rollingMinutes} min to ${fmtClock(clock.t)})` : ''}`;
  g.fillText(`Window ${win} · ${filtersLabel()} · Units ${p.prefs.units === 'ft' ? 'feet' : 'meters'} · Playback time ${fmtClock(clock.t)} · Exported ${new Date().toLocaleDateString()}`, pad, y0 + 90 * k);
  // Quality notes.
  g.font = font(400, 10.5);
  const notes = qualityNotes();
  notes.slice(0, 3).forEach((n, i) => g.fillText(n, pad, y0 + (110 + i * 13) * k));
  // Designation badge (right).
  g.font = font(700, 12.5);
  const tw = g.measureText(des.label).width;
  const bx = W - pad - tw - 24 * k;
  g.fillStyle = des.tone === 'sim' ? '#fff3d6' : des.tone === 'obs' ? '#e1f0f6' : '#ece9e4';
  g.fillRect(bx, y0 + 16 * k, tw + 24 * k, 28 * k);
  g.fillStyle = des.tone === 'sim' ? '#8a5a00' : des.tone === 'obs' ? '#1f5f7a' : '#6e7378';
  g.fillText(des.label, bx + 12 * k, y0 + 24 * k);
  // Legend (right).
  drawLegend(g, W - pad - 300 * k, y0 + 58 * k, 300 * k, k);
  // Scale bar (inside plan, bottom-left).
  drawScaleBar(g, pad, y0 - 30 * k, k);
}

function drawLegend(g: CanvasRenderingContext2D, x: number, y: number, w: number, k: number) {
  const ui = useUI.getState();
  const p = useProject.getState().project!;
  const font = (wt: number, s: number) => `${wt} ${s * k}px Inter Variable, Inter, Helvetica, Arial, sans-serif`;
  g.textBaseline = 'top';
  const ramp = (name: 'warm' | 'blue', title: string, lo: string, hi: string) => {
    g.font = font(600, 11);
    g.fillStyle = '#1d2327';
    g.fillText(title, x, y);
    for (let i = 0; i < 100; i++) {
      g.fillStyle = rgbStr(rampRGB(name, i / 99));
      g.fillRect(x + (w * i) / 100, y + 16 * k, w / 100 + 1, 8 * k);
    }
    g.font = font(400, 10);
    g.fillStyle = '#6e7378';
    g.fillText(lo, x, y + 28 * k);
    const hw = g.measureText(hi).width;
    g.fillText(hi, x + w - hw, y + 28 * k);
  };
  if (ui.layers.heatmap.visible && ui.mode !== 'plan') {
    const name = { presence: 'Presence density', movement: 'Movement density', frequency: 'Circulation frequency (passes)', encounters: 'Encounter locations' }[ui.heatmap.metric];
    ramp(ui.heatmap.gradient === 'blue' ? 'blue' : 'warm', name, 'low', ui.heatmap.normalization === 'relative' ? 'peak in view' : 'high');
  } else if (ui.layers.occupancy.visible) {
    ramp('blue', `Rooms: ${ui.roomMetric}`, 'none', 'highest');
  } else if (ui.layers.congestion.visible) {
    ramp('warm', `Circulation overlap (threshold ${ui.congestionThreshold})`, '2 people', 'longest above');
  } else {
    // Role key.
    const ds = getActiveDataset(useData.getState());
    const present = new Set(ds?.tracks.map((t) => t.roleId));
    let cx = x;
    g.font = font(500, 10.5);
    for (const r of p.roles.filter((r) => present.has(r.id))) {
      g.fillStyle = r.color;
      g.beginPath();
      g.arc(cx + 5 * k, y + 6 * k, 4.5 * k, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3a4147';
      g.fillText(r.shortName, cx + 13 * k, y);
      cx += g.measureText(r.shortName).width + 26 * k;
    }
  }
}

function drawScaleBar(g: CanvasRenderingContext2D, x: number, y: number, k: number) {
  const p = useProject.getState().project!;
  const v = useView.getState();
  const pxPerUnit = (p.prefs.units === 'ft' ? v.scale / FT_PER_M : v.scale) * k;
  const len = [5, 10, 20, 25, 50, 100].find((n) => n * pxPerUnit > 90 * k) ?? 100;
  const L = len * pxPerUnit;
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(x - 6 * k, y - 18 * k, L + 60 * k, 30 * k);
  g.fillStyle = '#1d2327';
  g.fillRect(x, y, L, 4 * k);
  g.font = `500 ${10 * k}px Inter Variable, Helvetica, sans-serif`;
  g.textBaseline = 'bottom';
  g.fillText(`0`, x, y - 2 * k);
  g.fillText(`${len} ${p.prefs.units}`, x + L - 10 * k, y - 2 * k);
}

export async function exportPng(o: GraphicOptions) {
  const c = await renderViewCanvas(o);
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
  const p = useProject.getState().project!;
  downloadBlob(blob, `${safeFileName(p.meta.name)}_${safeFileName(o.analysisLabel)}.png`);
}

/** Presentation PDF: view image, title block, key metrics and definitions. */
export async function exportPdfReport(o: GraphicOptions) {
  const p = useProject.getState().project!;
  const c = await renderViewCanvas({ ...o, scale: Math.max(2, o.scale) });
  const { jsPDF: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'tabloid' });
  // Built-in PDF fonts are WinAnsi only: replace symbols they cannot encode.
  const pdfSafe = (t: string) => t.replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[–—]/g, '-').replace(/×/g, 'x').replace(/·/g, '|').replace(/[^\x00-\xff]/g, '?');
  const rawText = doc.text.bind(doc) as (t: string, x: number, y: number) => jsPDF;
  (doc as unknown as { text: (t: string, x: number, y: number) => jsPDF }).text = (t, x, y) => rawText(pdfSafe(t), x, y);
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const m = 36;
  const ratio = c.width / c.height;
  const imgW = PW - 2 * m;
  const imgH = Math.min(PH - 2 * m - 40, imgW / ratio);
  doc.addImage(c.toDataURL('image/png'), 'PNG', m, m, imgH * ratio, imgH, undefined, 'FAST');
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(`BSA Flow Explorer — ${datasetDesignation().label} — page 1`, m, PH - 18);

  // Page 2: metrics summary.
  const ds = getActiveDataset(useData.getState());
  if (ds) {
    const pb = usePlayback.getState();
    const a = analyzeCached(ds.tracks, p.spatial, p.roomTypes, [pb.rangeStart, pb.rangeEnd]);
    doc.addPage('tabloid', 'landscape');
    const unit = p.prefs.units;
    let y = m + 10;
    doc.setTextColor(29, 35, 39);
    doc.setFontSize(18);
    doc.text(`${p.meta.name} — summary`, m, y);
    y += 20;
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(`${datasetDesignation().label} · Window ${fmtClock(pb.rangeStart)}–${fmtClock(pb.rangeEnd)} · ${filtersLabel()}`, m, y);
    y += 26;
    const total = a.staff.reduce((s, x) => s + x.distanceM, 0);
    const kpis: [string, string][] = [
      ['Tracked staff', String(a.staff.length)],
      ['Total distance', fmtDistanceLong(total, unit)],
      ['Average per person', fmtDistanceLong(a.staff.length ? total / a.staff.length : NaN, unit)],
      ['Journeys', String(a.trips.length)],
      ['Time moving', fmtPct(a.staff.reduce((s, x) => s + x.movingS, 0) / Math.max(1, a.staff.reduce((s, x) => s + x.trackedS, 0)))],
    ];
    doc.setTextColor(29, 35, 39);
    kpis.forEach(([kk, v], i) => {
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(kk.toUpperCase(), m + i * 150, y);
      doc.setFontSize(16);
      doc.setTextColor(29, 35, 39);
      doc.text(v, m + i * 150, y + 18);
    });
    y += 50;
    const table = (title: string, head: string[], rows: string[][], x: number, yy: number, widths: number[]) => {
      doc.setFontSize(11);
      doc.setTextColor(29, 35, 39);
      doc.text(title, x, yy);
      yy += 14;
      doc.setFontSize(8.5);
      doc.setTextColor(110);
      let cx = x;
      head.forEach((h, i) => (doc.text(h, cx, yy), (cx += widths[i])));
      doc.setTextColor(40);
      for (const r of rows) {
        yy += 12;
        cx = x;
        r.forEach((v, i) => (doc.text(v, cx, yy), (cx += widths[i])));
      }
      return yy;
    };
    const minGroup = p.prefs.minGroupSize;
    const roleRows = p.roles
      .map((r) => {
        const st = a.staff.filter((s) => s.roleId === r.id);
        if (!st.length) return null;
        if (st.length < minGroup) return [r.name, String(st.length), 'suppressed', '', ''];
        const h = st.reduce((s, x) => s + x.trackedS, 0) / 3600;
        const d = st.reduce((s, x) => s + x.distanceM, 0);
        const t = st.reduce((s, x) => s + x.trips.length, 0);
        return [r.name, String(st.length), fmtDistance(d / st.length, unit), fmtDistance(d / h, unit), (t / h).toFixed(1)];
      })
      .filter(Boolean) as string[][];
    table('By role', ['Role', 'n', 'Distance / person', 'Distance / hour', 'Trips / hour'], roleRows, m, y, [180, 40, 100, 100, 80]);
    const range = pb.rangeEnd - pb.rangeStart;
    const sensitive = new Set(p.spatial.rooms.filter((r) => r.sensitive).map((r) => r.id));
    const rooms = a.spaces
      .filter((s) => s.kind === 'room' && !sensitive.has(s.id))
      .sort((x1, x2) => x2.dwellS - x1.dwellS)
      .slice(0, 18)
      .map((s) => [s.name, String(s.visitCount), fmtDuration(s.dwellS), fmtPct(s.presenceS / range), String(s.peakOccupancy)]);
    table('Rooms by staff dwell (top 18; sensitive rooms excluded)', ['Room', 'Visits', 'Dwell', '≥1 present', 'Peak'], rooms, m + 560, y, [170, 50, 80, 70, 40]);
    const od = buildOD(a.trips, getLocator(p.spatial), 'type');
    const odRows = [...od.cells.values()]
      .sort((x1, x2) => x2.trips - x1.trips)
      .slice(0, 12)
      .map((c) => [`${c.from} → ${c.to}`, String(c.trips), fmtDistance(c.totalDistanceM / c.trips, unit)]);
    table('Top origin → destination relationships', ['Relationship', 'Trips', 'Avg length'], odRows, m, y + 150, [330, 50, 80]);
    let ny = PH - 120;
    doc.setFontSize(9);
    doc.setTextColor(29, 35, 39);
    doc.text('Data notes', m, ny);
    doc.setTextColor(90);
    for (const n of qualityNotes()) {
      ny += 12;
      doc.text(`• ${n}`, m, ny);
    }
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(`BSA Flow Explorer — ${datasetDesignation().label} — page 2`, m, PH - 18);
  }
  doc.save(`${safeFileName(p.meta.name)}_${safeFileName(o.analysisLabel)}_report.pdf`);
}

// --- CSV --------------------------------------------------------------------

function csvHeader(kind: string): string {
  const p = useProject.getState().project!;
  const pb = usePlayback.getState();
  return [
    `# BSA Flow Explorer export: ${kind}`,
    `# Project: ${p.meta.name}`,
    `# Dataset: ${datasetDesignation().label}`,
    `# Window: ${fmtClock(pb.rangeStart, true)} - ${fmtClock(pb.rangeEnd, true)} (local study time); filters: ${filtersLabel()}`,
    `# Units: meters, seconds; world coordinates (x right, y down from drawing origin)`,
    `# Exported: ${new Date().toISOString()}`,
  ].join('\n');
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string, cols: string[], rows: unknown[][]) =>
  `${header}\n${cols.join(',')}\n${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`;

function activeAnalysis() {
  const p = useProject.getState().project!;
  const ds = getActiveDataset(useData.getState());
  if (!ds) throw new Error('No dataset');
  const pb = usePlayback.getState();
  const rf = useUI.getState().roleFilter;
  const tracks = rf.length ? ds.tracks.filter((t) => rf.includes(t.roleId ?? '')) : ds.tracks;
  return { p, ds, tracks, a: analyzeCached(tracks, p.spatial, p.roomTypes, [pb.rangeStart, pb.rangeEnd]), pb };
}

const codeOf = (id: string) => useProject.getState().project!.staff.find((s) => s.id === id)?.code ?? id;
const roleOf = (id: string | null) => useProject.getState().project!.roles.find((r) => r.id === id)?.name ?? '';

export function exportObservationsCsv() {
  const { p, tracks, pb } = activeAnalysis();
  const rows: unknown[][] = [];
  for (const t of tracks) {
    for (let i = 0; i < t.t.length; i++) {
      if (t.t[i] < pb.rangeStart || t.t[i] > pb.rangeEnd) continue;
      rows.push([codeOf(t.staffId), roleOf(t.roleId), t.t[i].toFixed(2), fmtClock(t.t[i], true), t.x[i].toFixed(3), t.y[i].toFixed(3), t.gap[i]]);
    }
  }
  downloadBlob(new Blob([csv(csvHeader('movement observations'), ['tag', 'role', 't_seconds', 'clock', 'x_m', 'y_m', 'gap_before'], rows)], { type: 'text/csv' }), `${safeFileName(p.meta.name)}_observations.csv`);
}

export function exportStaffCsv() {
  const { p, a } = activeAnalysis();
  const rows = a.staff.map((s) => [
    codeOf(s.staffId),
    roleOf(s.roleId),
    s.trackedS.toFixed(0),
    s.gapS.toFixed(0),
    s.distanceM.toFixed(1),
    s.gapBridgeM.toFixed(1),
    s.movingS.toFixed(0),
    s.stationaryS.toFixed(0),
    s.visits.length,
    s.trips.length,
    new Set(s.visits.map((v) => v.roomId)).size,
  ]);
  downloadBlob(
    new Blob([csv(csvHeader('staff-level statistics'), ['tag', 'role', 'tracked_s', 'gap_s', 'distance_m', 'gap_straight_line_m_estimated', 'moving_s', 'stationary_s', 'visits', 'trips', 'rooms_visited'], rows)], { type: 'text/csv' }),
    `${safeFileName(p.meta.name)}_staff_stats.csv`,
  );
}

export function exportRoomsCsv() {
  const { p, a, pb } = activeAnalysis();
  const range = pb.rangeEnd - pb.rangeStart;
  const sensitive = new Set(p.spatial.rooms.filter((r) => r.sensitive).map((r) => r.id));
  const rows = a.spaces.map((s) =>
    sensitive.has(s.id)
      ? [s.name, s.type, s.kind, 'sensitive — excluded', '', '', '', '', '', '']
      : [s.name, s.type, s.kind, s.visitCount, s.dwellS.toFixed(0), s.avgVisitS.toFixed(0), s.presenceS.toFixed(0), (s.presenceS / range).toFixed(3), s.personS.toFixed(0), s.peakOccupancy],
  );
  downloadBlob(
    new Blob([csv(csvHeader('room-level statistics (tracked staff presence, not clinical utilisation)'), ['space', 'type', 'kind', 'visits', 'dwell_s', 'avg_visit_s', 'presence_s', 'presence_share', 'person_s', 'peak_simultaneous'], rows)], { type: 'text/csv' }),
    `${safeFileName(p.meta.name)}_room_stats.csv`,
  );
}

export function exportOdCsv(by: 'type' | 'room' = 'type') {
  const { p, a } = activeAnalysis();
  const od = buildOD(a.trips, a.locator, by);
  const name = (k: string) => (by === 'type' ? k : (a.locator.spaces[a.locator.index.get(k) ?? -1]?.name ?? k));
  const rows = [...od.cells.values()].map((c) => [name(c.from), name(c.to), c.trips, c.totalDistanceM.toFixed(1), (c.totalDistanceM / c.trips).toFixed(1), c.totalTimeS.toFixed(0), c.gapTrips, Object.entries(c.byRole).map(([r, n]) => `${roleOf(r) || 'unassigned'}:${n}`).join('; ')]);
  downloadBlob(
    new Blob([csv(csvHeader(`origin-destination relationships by ${by}`), ['origin', 'destination', 'trips', 'total_distance_m', 'avg_distance_m', 'total_time_s', 'trips_with_gaps', 'trips_by_role'], rows)], { type: 'text/csv' }),
    `${safeFileName(p.meta.name)}_od_${by}.csv`,
  );
}

export function exportProjectJson() {
  const p = useProject.getState().project!;
  downloadBlob(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), `${safeFileName(p.meta.name)}_project.json`);
}
