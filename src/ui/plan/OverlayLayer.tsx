/**
 * Screen-space overlay: labels, door and anchor symbols, selection outlines,
 * vertex handles and in-progress drawing drafts. Constant on-screen size
 * regardless of zoom.
 */
import type { Polygon, Vec2 } from '@/domain/types';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { useView, worldToScreen } from '@/store/viewStore';
import { centroid, bbox } from '@/geometry/polygon';
import { apply, sheetToWorld } from '@/geometry/calibration';
import { dist } from '@/geometry/vec';
import { fmtDistance } from '@/ui/format';
import { useSpatialContext } from '@/store/derived';

export type Draft =
  | { kind: 'polygon'; target: 'room' | 'circulation' | 'obstacle'; points: Vec2[]; cursor: Vec2 | null }
  | { kind: 'rect'; target: 'room' | 'circulation' | 'obstacle'; a: Vec2; b: Vec2 }
  | { kind: 'measure'; a: Vec2; b: Vec2 | null; done: boolean }
  | { kind: 'calibrate'; a: Vec2; b: Vec2 | null; done: boolean } // sheet coords
  | { kind: 'verify'; a: Vec2; b: Vec2 | null; done: boolean } // sheet coords
  | null;

const ACCENT = '#a85d23';

export function OverlayLayer({ draft, snap }: { draft: Draft; snap: Vec2 | null }) {
  const view = useView();
  const project = useProject((s) => s.project!);
  const layers = useUI((s) => s.layers);
  const selection = useUI((s) => s.selection);
  const hover = useUI((s) => s.hover);
  const tool = useUI((s) => s.tool);
  const mode = useUI((s) => s.mode);
  const ctx = useSpatialContext();
  const S = (p: Vec2) => worldToScreen(view, p);
  const sheetToScreen = (p: Vec2) => S(apply(sheetToWorld(project.calibration), p));
  const unit = project.prefs.units;
  const { rooms, doors, anchors, circulation, obstacles } = project.spatial;

  const polyPts = (poly: Polygon) => poly.map((p) => S(p)).map((p) => `${p.x},${p.y}`).join(' ');
  const selPoly = (() => {
    if (!selection) return null;
    if (selection.kind === 'room') return rooms.find((r) => r.id === selection.id)?.polygon ?? null;
    if (selection.kind === 'circulation') return circulation.find((r) => r.id === selection.id)?.polygon ?? null;
    if (selection.kind === 'obstacle') return obstacles.find((r) => r.id === selection.id)?.polygon ?? null;
    return null;
  })();
  const hoverPoly =
    hover && hover.kind === 'room' ? rooms.find((r) => r.id === hover.id)?.polygon : hover?.kind === 'circulation' ? circulation.find((c) => c.id === hover.id)?.polygon : null;
  const showHandles = tool === 'edit-polygon' && selPoly;
  const showDoors = layers.doors.visible && mode !== 'present' && (mode === 'plan' || view.scale > 14);

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full select-none">
      {/* Hover / selection outlines */}
      {hoverPoly && hoverPoly !== selPoly && <polygon points={polyPts(hoverPoly)} fill="none" stroke={ACCENT} strokeOpacity={0.45} strokeWidth={1.5} />}
      {selPoly && <polygon points={polyPts(selPoly)} fill={ACCENT} fillOpacity={0.06} stroke={ACCENT} strokeWidth={2} />}

      {/* Room labels */}
      {layers.roomLabels.visible &&
        rooms.map((r) => {
          const b = bbox(r.polygon);
          const wPx = (b.maxX - b.minX) * view.scale;
          const hPx = (b.maxY - b.minY) * view.scale;
          if (wPx < 34 || hPx < 18) return null;
          const c = S(ctx.activityPoint.get(r.id) ?? centroid(r.polygon));
          const small = wPx < 70;
          const name = r.name || r.type;
          return (
            <g key={r.id} opacity={layers.roomLabels.opacity}>
              <text x={c.x} y={c.y - (small ? 1 : 2)} textAnchor="middle" fontSize={small ? 9 : 10.5} fontWeight={600} fill="#2b3136" letterSpacing="0.02em" style={{ paintOrder: 'stroke', stroke: 'rgba(255,255,255,0.85)', strokeWidth: 3 }}>
                {name.length > 18 && small ? name.slice(0, 16) + '…' : name}
              </text>
              {r.number && hPx > 30 && (
                <text x={c.x} y={c.y + 10} textAnchor="middle" fontSize={9} fill="#6e7378" style={{ paintOrder: 'stroke', stroke: 'rgba(255,255,255,0.85)', strokeWidth: 3 }}>
                  {r.number}
                </text>
              )}
            </g>
          );
        })}

      {/* Doors */}
      {showDoors &&
        doors.map((d) => {
          const ref = ctx.grid.doors.find((x) => x.id === d.id);
          const p = S(d.position);
          const half = (d.widthM / 2) * view.scale;
          const u = ref?.along ?? { x: 1, y: 0 };
          const sel = selection?.kind === 'door' && selection.id === d.id;
          const bad = !!ref?.problem;
          const col = bad ? '#b33a3a' : sel ? ACCENT : '#2f6f6a';
          return (
            <g key={d.id} opacity={layers.doors.opacity}>
              <line x1={p.x - u.x * half} y1={p.y - u.y * half} x2={p.x + u.x * half} y2={p.y + u.y * half} stroke={col} strokeWidth={sel ? 4 : 3} strokeLinecap="round" opacity={0.85} />
              <circle cx={p.x} cy={p.y} r={sel ? 4.5 : 3.2} fill="#fff" stroke={col} strokeWidth={1.5} />
              {d.oneWayFromSpaceId && <path d={`M ${p.x - u.y * 9} ${p.y + u.x * 9} l ${u.y * 6} ${-u.x * 6}`} stroke={col} strokeWidth={1.5} />}
            </g>
          );
        })}

      {/* Anchors */}
      {layers.anchors.visible &&
        anchors.map((a) => {
          const p = S(a.position);
          const sel = selection?.kind === 'anchor' && selection.id === a.id;
          const col = a.status === 'surveyed' ? '#2f7a4f' : a.status === 'installed' ? '#1f5f7a' : '#5b4a8a';
          return (
            <g key={a.id} opacity={layers.anchors.opacity}>
              {a.surveyedPosition && (
                <line x1={p.x} y1={p.y} x2={S(a.surveyedPosition).x} y2={S(a.surveyedPosition).y} stroke={col} strokeDasharray="2 2" />
              )}
              <rect x={p.x - 5} y={p.y - 5} width={10} height={10} transform={`rotate(45 ${p.x} ${p.y})`} fill={sel ? ACCENT : '#fff'} stroke={sel ? ACCENT : col} strokeWidth={1.6} />
              <text x={p.x + 9} y={p.y + 3.5} fontSize={9.5} fontWeight={600} fill={col} style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>
                {a.label}
              </text>
            </g>
          );
        })}

      {/* Vertex handles */}
      {showHandles &&
        selPoly!.map((v, i) => {
          const p = S(v);
          const n = S(selPoly![(i + 1) % selPoly!.length]);
          return (
            <g key={i}>
              <circle cx={(p.x + n.x) / 2} cy={(p.y + n.y) / 2} r={2.5} fill={ACCENT} opacity={0.5} />
              <rect x={p.x - 4} y={p.y - 4} width={8} height={8} fill="#fff" stroke={ACCENT} strokeWidth={1.5} />
            </g>
          );
        })}

      {/* Drafts */}
      {draft?.kind === 'polygon' && (
        <g>
          <polyline
            points={[...draft.points, ...(draft.cursor ? [draft.cursor] : [])].map((p) => S(p)).map((p) => `${p.x},${p.y}`).join(' ')}
            fill={ACCENT}
            fillOpacity={0.08}
            stroke={ACCENT}
            strokeWidth={1.6}
            strokeDasharray="5 3"
          />
          {draft.points.map((p, i) => {
            const s = S(p);
            return <circle key={i} cx={s.x} cy={s.y} r={i === 0 ? 5 : 3} fill={i === 0 ? '#fff' : ACCENT} stroke={ACCENT} strokeWidth={1.5} />;
          })}
          {draft.cursor && draft.points.length > 0 && <DimLabel a={S(draft.points[draft.points.length - 1])} b={S(draft.cursor)} text={fmtDistance(dist(draft.points[draft.points.length - 1], draft.cursor), unit)} />}
        </g>
      )}
      {draft?.kind === 'rect' && (() => {
        const a = S(draft.a);
        const b = S(draft.b);
        return (
          <g>
            <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={ACCENT} fillOpacity={0.08} stroke={ACCENT} strokeWidth={1.6} strokeDasharray="5 3" />
            <text x={(a.x + b.x) / 2} y={Math.min(a.y, b.y) - 6} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={ACCENT} style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>
              {fmtDistance(Math.abs(draft.b.x - draft.a.x), unit)} × {fmtDistance(Math.abs(draft.b.y - draft.a.y), unit)}
            </text>
          </g>
        );
      })()}
      {draft?.kind === 'measure' && draft.b && <MeasureLine a={S(draft.a)} b={S(draft.b)} text={fmtDistance(dist(draft.a, draft.b), unit) + (project.calibration.calibrated ? '' : ' (unverified scale)')} />}
      {draft && (draft.kind === 'calibrate' || draft.kind === 'verify') && (
        <MeasureLine a={sheetToScreen(draft.a)} b={draft.b ? sheetToScreen(draft.b) : sheetToScreen(draft.a)} text={draft.kind === 'calibrate' ? 'Reference dimension' : 'Verification dimension'} color="#1f5f7a" />
      )}

      {/* Snap indicator */}
      {snap && (() => {
        const s = S(snap);
        return <rect x={s.x - 6} y={s.y - 6} width={12} height={12} fill="none" stroke="#1f5f7a" strokeWidth={1.5} />;
      })()}
    </svg>
  );
}

function DimLabel({ a, b, text }: { a: Vec2; b: Vec2; text: string }) {
  return (
    <text x={(a.x + b.x) / 2 + 8} y={(a.y + b.y) / 2 - 8} fontSize={10.5} fontWeight={600} fill={ACCENT} style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>
      {text}
    </text>
  );
}

function MeasureLine({ a, b, text, color = ACCENT }: { a: Vec2; b: Vec2; text: string; color?: string }) {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
  const tick = (p: Vec2) => <line x1={p.x - n.x * 7} y1={p.y - n.y * 7} x2={p.x + n.x * 7} y2={p.y + n.y * 7} stroke={color} strokeWidth={1.5} />;
  return (
    <g>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1.6} />
      {tick(a)}
      {tick(b)}
      <circle cx={a.x} cy={a.y} r={3} fill="#fff" stroke={color} strokeWidth={1.5} />
      <circle cx={b.x} cy={b.y} r={3} fill="#fff" stroke={color} strokeWidth={1.5} />
      <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 9} textAnchor="middle" fontSize={11} fontWeight={600} fill={color} style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3.5 }}>
        {text}
      </text>
    </g>
  );
}
