/** Chooses analysis overlays and legends for the current mode/view. */
import { useUI } from '@/store/uiStore';
import { CongestionLayer, CongestionLegend, DiffHeatLayer, DiffLegend, HeatLegend, HeatmapLayer, ODLayer, ODLegend } from './AnalysisLayers';
import { ChoroplethLegend } from '@/ui/analyze/shared';
import { useCompareSides, useDiffHeat } from './useDiffHeat';

export function useAnalysisOverlay() {
  const mode = useUI((s) => s.mode);
  const view = useUI((s) => s.analysisView);
  const layers = useUI((s) => s.layers);
  const cmp = useUI((s) => s.compare);
  const active = mode !== 'plan';
  const compareDiff = active && mode !== 'explore' && view === 'compare' && cmp.mode !== 'roles' && cmp.diffMap;
  const sides = useCompareSides();
  const diff = useDiffHeat(compareDiff ? sides : null, compareDiff);
  const showOD = active && mode !== 'explore' && view === 'od';
  const layersEl = active ? (
    <>
      {layers.heatmap.visible && !compareDiff && <HeatmapLayer />}
      {compareDiff && <DiffHeatLayer diff={diff} />}
      {layers.congestion.visible && <CongestionLayer />}
      {showOD && <ODLayer />}
    </>
  ) : null;
  const legends = active ? (
    <div className="pointer-events-none absolute bottom-16 left-3 z-10 flex flex-col gap-2">
      {layers.heatmap.visible && !compareDiff && <HeatLegend />}
      {compareDiff && sides && <DiffLegend diff={diff} labelA={sides.a.label} labelB={sides.b.label} />}
      {layers.occupancy.visible && <ChoroplethLegend />}
      {layers.congestion.visible && <CongestionLegend />}
      {showOD && <ODLegend />}
    </div>
  ) : null;
  return { layersEl, legends };
}
