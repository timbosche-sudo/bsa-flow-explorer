import { useEffect, useRef } from 'react';
import { Focus, Maximize, Minus, Plus, Scan } from 'lucide-react';
import { useUI } from '@/store/uiStore';
import { useView } from '@/store/viewStore';
import { useProject } from '@/store/projectStore';
import { IconButton, Segmented, cx } from '@/ui/components/controls';
import { TOOLS } from './tools';
import { viewCommands } from './FloorPlanView';
import { FT_PER_M } from '@/geometry/calibration';

export function ToolPalette() {
  const mode = useUI((s) => s.mode);
  const tool = useUI((s) => s.tool);
  const setTool = useUI((s) => s.setTool);
  const shapeMode = useUI((s) => s.shapeMode);
  const setShapeMode = useUI((s) => s.setShapeMode);
  const tools = TOOLS.filter((t) => t.modes.includes(mode));
  const groups = mode === 'plan' ? [tools.filter((t) => !t.editing), tools.filter((t) => t.editing)] : [tools];
  return (
    <div className="absolute top-3 left-3 z-10 flex items-start gap-2" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <div className="flex flex-col rounded-[4px] border border-line bg-paper/95 p-1 shadow-sm backdrop-blur">
        {groups.map((g, gi) => (
          <div key={gi} className={cx('flex flex-col gap-0.5', gi > 0 && 'mt-1 border-t border-line-2 pt-1')}>
            {g.map((t) => (
              <IconButton key={t.id} title={`${t.label} (${t.key})`} active={tool === t.id} onClick={() => setTool(t.id)}>
                {t.icon}
              </IconButton>
            ))}
          </div>
        ))}
      </div>
      {(tool === 'circulation' || tool === 'obstacle') && (
        <div className="rounded-[4px] border border-line bg-paper/95 p-1 shadow-sm">
          <Segmented size="sm" value={shapeMode} onChange={setShapeMode} options={[{ value: 'rect', label: 'Rectangle' }, { value: 'polygon', label: 'Polygon' }]} />
        </div>
      )}
    </div>
  );
}

export function ZoomControls() {
  const zoomAt = useView((s) => s.zoomAt);
  const center = () => {
    const v = useView.getState();
    return { x: v.width / 2, y: v.height / 2 };
  };
  const sel = useUI((s) => s.selection);
  return (
    <div className="absolute right-3 bottom-3 z-10 flex flex-col rounded-[4px] border border-line bg-paper/95 p-1 shadow-sm" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <IconButton title="Zoom in" onClick={() => zoomAt(center(), 1.4)}>
        <Plus size={15} />
      </IconButton>
      <IconButton title="Zoom out" onClick={() => zoomAt(center(), 1 / 1.4)}>
        <Minus size={15} />
      </IconButton>
      <div className="my-0.5 border-t border-line-2" />
      <IconButton title="Fit plan to screen (F)" onClick={() => viewCommands.fitPlan()}>
        <Scan size={15} />
      </IconButton>
      <IconButton title="Zoom to drawing extents" onClick={() => viewCommands.fitPage()}>
        <Maximize size={15} />
      </IconButton>
      <IconButton title="Zoom to selected room" disabled={!sel || !['room', 'circulation', 'obstacle'].includes(sel.kind)} onClick={() => viewCommands.fitSelection()}>
        <Focus size={15} />
      </IconButton>
    </div>
  );
}

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];

export function ScaleBar() {
  const scale = useView((s) => s.scale);
  const prefs = useProject((s) => s.project!.prefs);
  const calibrated = useProject((s) => s.project!.calibration.calibrated);
  if (!prefs.showScaleBar) return null;
  const unit = prefs.units;
  const pxPerUnit = unit === 'ft' ? scale / FT_PER_M : scale;
  const target = 120 / pxPerUnit;
  const len = NICE.find((n) => n >= target * 0.6) ?? 500;
  const px = len * pxPerUnit;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-[3px] bg-paper/90 px-2 pt-1 pb-1.5 shadow-sm">
      <div className="mb-0.5 flex justify-between text-[10px] font-medium text-ink-2 tnum" style={{ width: px }}>
        <span>0</span>
        <span>{len / 2}</span>
        <span>
          {len} {unit}
        </span>
      </div>
      <div className="flex h-[5px] border border-ink" style={{ width: px }}>
        <div className="h-full w-1/4 bg-ink" />
        <div className="h-full w-1/4" />
        <div className="h-full w-1/2 bg-ink" />
      </div>
      {!calibrated && <div className="mt-1 text-[9.5px] font-semibold tracking-wide text-warn uppercase">Uncalibrated — assumed scale</div>}
    </div>
  );
}

/** Light measurement grid in world units (1 m or 5 ft / 10 ft major). */
export function GridLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const show = useProject((s) => s.project!.prefs.showGrid);
  const unit = useProject((s) => s.project!.prefs.units);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const v = useView.getState();
      const dpr = window.devicePixelRatio || 1;
      c.width = v.width * dpr;
      c.height = v.height * dpr;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, v.width, v.height);
      if (!show) return;
      const stepM = unit === 'ft' ? (v.scale > 25 ? 5 : 10) / FT_PER_M : v.scale > 25 ? 1 : 5;
      const px = stepM * v.scale;
      if (px < 6) return;
      ctx.strokeStyle = 'rgba(31,95,122,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const x0 = ((v.tx % px) + px) % px;
      const y0 = ((v.ty % px) + px) % px;
      for (let x = x0; x < v.width; x += px) (ctx.moveTo(Math.round(x) + 0.5, 0), ctx.lineTo(Math.round(x) + 0.5, v.height));
      for (let y = y0; y < v.height; y += px) (ctx.moveTo(0, Math.round(y) + 0.5), ctx.lineTo(v.width, Math.round(y) + 0.5));
      ctx.stroke();
    };
    draw();
    return useView.subscribe(draw);
  }, [show, unit]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
