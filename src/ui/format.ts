import type { LengthUnit } from '@/domain/types';
import { FT_PER_M } from '@/geometry/calibration';

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Distance with sensible rounding: < 10 -> 1 decimal, otherwise integer. */
export function fmtDistance(m: number | null | undefined, unit: LengthUnit): string {
  if (m == null || !Number.isFinite(m)) return '—';
  const v = unit === 'ft' ? m * FT_PER_M : m;
  const u = unit === 'ft' ? 'ft' : 'm';
  if (Math.abs(v) >= 10000) return `${nf0.format(Math.round(v / 10) * 10)} ${u}`;
  return `${Math.abs(v) < 10 ? nf1.format(v) : nf0.format(v)} ${u}`;
}

/** Long distances: miles / km when large. */
export function fmtDistanceLong(m: number | null | undefined, unit: LengthUnit): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (unit === 'ft' && m > 1609.344) return `${nf1.format(m / 1609.344)} mi`;
  if (unit === 'm' && m > 1000) return `${nf1.format(m / 1000)} km`;
  return fmtDistance(m, unit);
}

export function fmtArea(m2: number, unit: LengthUnit): string {
  if (!Number.isFinite(m2)) return '—';
  return unit === 'ft' ? `${nf0.format(m2 * FT_PER_M * FT_PER_M)} sf` : `${nf1.format(m2)} m²`;
}

/** Feet-inches string, e.g. 12'-6". */
export function fmtFeetInches(m: number): string {
  const totalIn = Math.round(m * FT_PER_M * 12);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  return `${ft}'-${inch}"`;
}

/** Clock time from seconds since midnight. */
export function fmtClock(s: number, seconds = false): string {
  if (!Number.isFinite(s)) return '—';
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return seconds
    ? `${h12}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')} ${ampm}`
    : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Duration from seconds: 45 s, 12 min, 2 h 05 min. */
export function fmtDuration(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m === 60 ? `${h + 1} h 00 min` : `${h} h ${String(m).padStart(2, '0')} min`;
}

export function fmtPct(f: number | null | undefined, digits = 0): string {
  if (f == null || !Number.isFinite(f)) return '—';
  return `${(f * 100).toFixed(digits)}%`;
}

export const fmtInt = (n: number) => (Number.isFinite(n) ? nf0.format(n) : '—');
export const fmtNum = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');

export const minutesToClockInput = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
export const clockInputToMinutes = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
