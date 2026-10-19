/**
 * World-space vector layer for rooms, zones, circulation, obstacles, doors and
 * anchors. Rendered as SVG inside a single transformed group; element count
 * is proportional to the number of spaces (tens to hundreds), never to the
 * number of tracking observations.
 */
import { memo } from 'react';
import type { Polygon, Project } from '@/domain/types';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { useView } from '@/store/viewStore';
import { useSpatialContext } from '@/store/derived';

export const polyPoints = (p: Polygon) => p.map((v) => `${v.x},${v.y}`).join(' ');

export function useTypeColor() {
  const types = useProject((s) => s.project!.roomTypes);
  return (t: string) => types.find((x) => x.name === t)?.color ?? '#a9a6a0';
}

export function GeometryLayer({ roomFill }: { roomFill?: Map<string, string> | null }) {
  const scale = useView((s) => s.scale);
  const tx = useView((s) => s.tx);
  const ty = useView((s) => s.ty);
  const project = useProject((s) => s.project!);
  const layers = useUI((s) => s.layers);
  const mode = useUI((s) => s.mode);
  const showNav = layers.navGrid.visible;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      <g transform={`matrix(${scale},0,0,${scale},${tx},${ty})`}>
        <Shapes project={project} layers={layers} mode={mode} roomFill={roomFill ?? null} />
        {showNav && <NavGridOverlay />}
      </g>
    </svg>
  );
}

const Shapes = memo(function Shapes({
  project,
  layers,
  mode,
  roomFill,
}: {
  project: Project;
  layers: ReturnType<typeof useUI.getState>['layers'];
  mode: string;
  roomFill: Map<string, string> | null;
}) {
  const typeColor = (t: string) => project.roomTypes.find((x) => x.name === t)?.color ?? '#a9a6a0';
  const zoneColor = new Map(project.spatial.zones.map((z) => [z.id, z.color]));
  const planEmphasis = mode === 'plan' ? 1 : 0.55;
  const { rooms, circulation, obstacles } = project.spatial;
  return (
    <>
      {layers.circulation.visible && (
        <g opacity={layers.circulation.opacity * planEmphasis}>
          {circulation.map((c) => (
            <polygon
              key={c.id}
              points={polyPoints(c.polygon)}
              fill="#efe6d6"
              stroke="#c9b48f"
              strokeWidth={1}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}
      {layers.rooms.visible && (
        <g>
          {rooms.map((r) => {
            const choro = roomFill?.get(r.id);
            const fill = choro ?? r.color ?? typeColor(r.type);
            return (
              <polygon
                key={r.id}
                points={polyPoints(r.polygon)}
                fill={fill}
                fillOpacity={choro ? 0.82 * layers.rooms.opacity + 0.1 : 0.28 * layers.rooms.opacity * (mode === 'plan' ? 1 : 0.7)}
                stroke={choro ? '#ffffff' : fill}
                strokeOpacity={choro ? 0.9 : 0.85}
                strokeWidth={choro ? 1.2 : 1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      )}
      {layers.zones.visible && (
        <g opacity={layers.zones.opacity}>
          {rooms
            .filter((r) => r.zoneId && zoneColor.has(r.zoneId))
            .map((r) => (
              <polygon key={r.id} points={polyPoints(r.polygon)} fill={zoneColor.get(r.zoneId!)} stroke="none" />
            ))}
        </g>
      )}
      {layers.obstacles.visible && (
        <g opacity={layers.obstacles.opacity}>
          <defs>
            <pattern id="hatch" width="0.3" height="0.3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="0.3" stroke="#6e7378" strokeWidth="0.06" />
            </pattern>
          </defs>
          {obstacles.map((o) => (
            <polygon key={o.id} points={polyPoints(o.polygon)} fill="url(#hatch)" stroke="#6e7378" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      )}
    </>
  );
});

function NavGridOverlay() {
  const ctx = useSpatialContext();
  const g = ctx.grid;
  // Draw door footprints and blocked-transition cells as a diagnostic.
  const cells: { x: number; y: number; door: boolean }[] = [];
  for (let i = 0; i < g.cols * g.rows; i++) {
    if (g.door[i] >= 0) cells.push({ x: g.originX + (i % g.cols) * g.cell, y: g.originY + Math.floor(i / g.cols) * g.cell, door: true });
  }
  return (
    <g opacity={0.6}>
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={g.cell} height={g.cell} fill="#2a9d9a" />
      ))}
    </g>
  );
}
