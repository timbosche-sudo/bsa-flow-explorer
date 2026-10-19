/**
 * Viewport transform: screen = world * scale + (tx, ty), in CSS pixels.
 * `scale` is pixels per meter. Kept in a small store so overlays can
 * subscribe; high-frequency consumers read `useView.getState()` directly.
 */
import { create } from 'zustand';
import type { Vec2 } from '@/domain/types';
import type { BBox } from '@/geometry/polygon';

export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

interface ViewState extends ViewTransform {
  width: number;
  height: number;
  setView: (v: Partial<ViewTransform>) => void;
  setSize: (w: number, h: number) => void;
  zoomAt: (screen: Vec2, factor: number) => void;
  fitBox: (b: BBox, padding?: number) => void;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 800;

export const useView = create<ViewState>((set, get) => ({
  scale: 20,
  tx: 40,
  ty: 40,
  width: 800,
  height: 600,
  setView: (v) => set(v),
  setSize: (width, height) => set({ width, height }),
  zoomAt: (p, factor) => {
    const { scale, tx, ty } = get();
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
    const k = ns / scale;
    set({ scale: ns, tx: p.x - (p.x - tx) * k, ty: p.y - (p.y - ty) * k });
  },
  fitBox: (b, padding = 48) => {
    const { width, height } = get();
    const w = Math.max(1e-6, b.maxX - b.minX);
    const h = Math.max(1e-6, b.maxY - b.minY);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((width - 2 * padding) / w, (height - 2 * padding) / h)));
    set({
      scale,
      tx: width / 2 - ((b.minX + b.maxX) / 2) * scale,
      ty: height / 2 - ((b.minY + b.maxY) / 2) * scale,
    });
  },
}));

export const worldToScreen = (v: ViewTransform, p: Vec2): Vec2 => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });
export const screenToWorld = (v: ViewTransform, p: Vec2): Vec2 => ({ x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale });
