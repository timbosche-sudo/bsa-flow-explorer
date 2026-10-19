/**
 * Anchor planning aid: for each walkable cell, the number of planned anchors
 * within a user-chosen planning radius. Purely geometric — it is NOT radio
 * coverage. Real UWB performance depends on obstructions, antenna geometry,
 * RF conditions and hardware and must be verified on site.
 */
import { useMemo } from 'react';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { getLocator } from '@/store/analysis';
import { emptyGrid } from '@/analytics/heatmap';
import { heatBitmap, drawGrid, LegendBox } from './AnalysisLayers';
import { useView } from '@/store/viewStore';
import { useEffect, useRef } from 'react';

const COLORS: [number, number, number][] = [
  [208, 59, 59], // 0
  [236, 131, 90], // 1
  [250, 178, 25], // 2
  [109, 167, 236], // 3
  [37, 106, 191], // 4+
];

export function AnchorLayer() {
  const spatial = useProject((s) => s.project!.spatial);
  const plan = useUI((s) => s.anchorPlan);
  const layer = useUI((s) => s.layers.anchors);
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useMemo(() => {
    if (!plan.show || !spatial.anchors.length) return null;
    const grid = emptyGrid(spatial, 0.5, getLocator(spatial), new Set());
    const r2 = plan.radiusM * plan.radiusM;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const i = r * grid.cols + c;
        if (!grid.mask[i]) continue;
        const x = grid.originX + (c + 0.5) * grid.cell;
        const y = grid.originY + (r + 0.5) * grid.cell;
        let n = 0;
        for (const a of spatial.anchors) {
          if (a.status === 'removed') continue;
          const p = a.surveyedPosition ?? a.position;
          if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r2) n++;
        }
        grid.values[i] = n;
      }
    }
    const bmp = heatBitmap(grid, (i) => (grid.mask[i] ? ([...COLORS[Math.min(4, grid.values[i])], 120] as [number, number, number, number]) : null));
    let below = 0;
    let total = 0;
    for (let i = 0; i < grid.values.length; i++) if (grid.mask[i]) (total++, grid.values[i] < plan.minAnchors && below++);
    return { grid, bmp, belowShare: total ? below / total : 0 };
  }, [plan.show, plan.radiusM, plan.minAnchors, spatial]);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const v = useView.getState();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(v.width * dpr);
      c.height = Math.round(v.height * dpr);
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      if (data && layer.visible) drawGrid(g, dpr, data.grid, data.bmp, 0.8);
    };
    draw();
    return useView.subscribe(draw);
  }, [data, layer.visible]);
  return (
    <>
      <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />
      {data && layer.visible && (
        <div className="pointer-events-none absolute bottom-16 left-3 z-10">
          <LegendBox title="Planned anchors within radius" sub={`${plan.radiusM} m planning radius (geometric)`}>
            <div className="flex gap-1">
              {COLORS.map((c, i) => (
                <div key={i} className="flex-1 text-center text-[10px] text-muted">
                  <div className="mb-0.5 h-2.5 rounded-[2px]" style={{ background: `rgb(${c.join(',')})` }} />
                  {i === 4 ? '4+' : i}
                </div>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-ink-2">{Math.round(data.belowShare * 100)}% of walkable area has fewer than {plan.minAnchors} anchors in range.</div>
            <div className="mt-1 text-[10px] leading-snug text-muted">Geometric distance only — not verified radio coverage. Walls, equipment, antenna orientation and RF conditions are not modelled.</div>
          </LegendBox>
        </div>
      )}
    </>
  );
}
