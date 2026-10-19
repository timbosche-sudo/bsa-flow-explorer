/**
 * Interactive floor plan workspace: owns the view transform, pointer
 * interaction and tool state machine. Rendering is split into layers:
 *   PdfLayer (canvas) → GeometryLayer (SVG, world) → dynamic canvases
 *   (heatmap, movement) → OverlayLayer (SVG, screen) → HUD.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Polygon, Vec2 } from '@/domain/types';
import { useProject } from '@/store/projectStore';
import { useUI, type ToolId } from '@/store/uiStore';
import { useView, screenToWorld } from '@/store/viewStore';
import { apply, calibrate, compose, measureSheet, sheetToWorld, toMeters, worldToSheet } from '@/geometry/calibration';
import { rectPolygon, validatePolygon, bbox, unionBBox, area } from '@/geometry/polygon';
import { closestOnSegment, dist } from '@/geometry/vec';
import { remapSpatial } from '@/geometry/remap';
import { uid } from '@/domain/defaults';
import { PdfLayer } from './PdfLayer';
import { GeometryLayer } from './GeometryLayer';
import { OverlayLayer, type Draft } from './OverlayLayer';
import { hitTestSpatial, orthogonal, snapEdge, snapVertex } from './hitTest';
import { toolById } from './tools';
import { Button, NumberInput, Segmented } from '@/ui/components/controls';
import type { LengthUnit } from '@/domain/types';

export interface FloorPlanViewProps {
  /** Extra canvas/SVG layers rendered between geometry and overlay. */
  dynamicLayers?: ReactNode;
  hud?: ReactNode;
  roomFill?: Map<string, string> | null;
  /** Custom click handler for analysis tools (select-staff, inspect). Return true if handled. */
  onAnalysisClick?: (world: Vec2, screen: Vec2, tolM: number, tool: ToolId) => boolean;
}

const SNAP_PX = 9;

export function FloorPlanView({ dynamicLayers, hud, roomFill, onAnalysisClick }: FloorPlanViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const project = useProject((s) => s.project!);
  const tool = useUI((s) => s.tool);
  const shapeMode = useUI((s) => s.shapeMode);
  const [draft, setDraft] = useState<Draft>(null);
  const [snap, setSnap] = useState<Vec2 | null>(null);
  const [calInput, setCalInput] = useState<{ value: number; unit: LengthUnit }>({ value: 10, unit: 'ft' });
  const drag = useRef<
    | { kind: 'pan'; start: Vec2; tx: number; ty: number; moved: boolean }
    | { kind: 'vertex'; index: number; target: 'rooms' | 'circulation' | 'obstacles'; id: string; original: Polygon }
    | { kind: 'rect'; a: Vec2 }
    | null
  >(null);
  const spaceDown = useRef(false);
  const fitted = useRef<string | null>(null);

  // --- view sizing & initial fit -------------------------------------------------
  useEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      useView.getState().setSize(r.width, r.height);
      if (fitted.current !== project.meta.id && r.width > 0) {
        fitted.current = project.meta.id;
        fitToPlan();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.meta.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitToPlan = useCallback(() => {
    const p = useProject.getState().project!;
    const polys = [...p.spatial.rooms.map((r) => r.polygon), ...p.spatial.circulation.map((c) => c.polygon)].filter((x) => x.length >= 3);
    let b = unionBBox(polys.map(bbox));
    if (!b) b = pageBox();
    useView.getState().fitBox(b, 56);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pageBox = () => {
    const p = useProject.getState().project!;
    const m = sheetToWorld(p.calibration);
    const W = p.floorPlan.pageWidth || 2592;
    const H = p.floorPlan.pageHeight || 1728;
    const corners = [apply(m, { x: 0, y: 0 }), apply(m, { x: W, y: 0 }), apply(m, { x: 0, y: H }), apply(m, { x: W, y: H })];
    return bbox(corners);
  };

  // Expose view commands for toolbar/HUD buttons.
  useEffect(() => {
    viewCommands.fitPlan = fitToPlan;
    viewCommands.fitPage = () => useView.getState().fitBox(pageBox(), 24);
    viewCommands.fitSelection = () => {
      const sel = useUI.getState().selection;
      const p = useProject.getState().project!;
      if (!sel) return;
      const poly =
        sel.kind === 'room'
          ? p.spatial.rooms.find((r) => r.id === sel.id)?.polygon
          : sel.kind === 'circulation'
            ? p.spatial.circulation.find((r) => r.id === sel.id)?.polygon
            : sel.kind === 'obstacle'
              ? p.spatial.obstacles.find((r) => r.id === sel.id)?.polygon
              : null;
      if (poly?.length) {
        const b = bbox(poly);
        const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.9;
        useView.getState().fitBox({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, 40);
      }
    };
  }, [fitToPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset drafts when tool changes.
  useEffect(() => {
    setDraft(null);
    setSnap(null);
  }, [tool, shapeMode]);

  // --- coordinate helpers ------------------------------------------------------------
  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (s: Vec2) => screenToWorld(useView.getState(), s);
  const tolM = (px = SNAP_PX) => px / useView.getState().scale;
  const toSheet = (w: Vec2) => apply(worldToSheet(project.calibration), w);

  const snapped = (w: Vec2, shift: boolean, from?: Vec2): { p: Vec2; snapped: Vec2 | null } => {
    let p = shift && from ? orthogonal(from, w) : w;
    const v = snapVertex(project, p, tolM());
    if (v) return { p: v, snapped: v };
    if (from && shift) return { p, snapped: null };
    const e = snapEdge(project, p, tolM(6));
    if (e) p = e;
    return { p, snapped: null };
  };

  // --- edit helpers ------------------------------------------------------------------
  const editSpatial = useProject((s) => s.editSpatial);
  const addItem = useProject((s) => s.addItem);
  const select = useUI((s) => s.select);
  const notify = useUI((s) => s.notify);

  const finishShape = (target: 'room' | 'circulation' | 'obstacle', poly: Polygon) => {
    if (validatePolygon(poly).length || area(poly) < 0.05) {
      notify('Shape is too small or invalid — not created.', 'warn');
      return;
    }
    if (target === 'room') {
      const n = project.spatial.rooms.length + 1;
      const id = uid('room');
      addItem(
        'rooms',
        {
          id,
          name: 'Room',
          number: String(100 + n),
          type: lastRoomType.current,
          department: '',
          zoneId: null,
          polygon: poly,
          activityPoint: null,
          notes: '',
          targetOccupancy: null,
          plannedUtilization: '',
          color: null,
          locked: false,
          restricted: false,
          staffOnly: true,
          sensitive: false,
        },
        'Create room',
      );
      select({ kind: 'room', id });
    } else if (target === 'circulation') {
      const id = uid('circ');
      addItem('circulation', { id, name: `Corridor ${project.spatial.circulation.length + 1}`, polygon: poly, locked: false }, 'Create circulation');
      select({ kind: 'circulation', id });
    } else {
      const id = uid('obs');
      addItem('obstacles', { id, name: `Obstacle ${project.spatial.obstacles.length + 1}`, polygon: poly }, 'Create obstacle');
      select({ kind: 'obstacle', id });
    }
  };
  const lastRoomType = useRef('Exam Room');

  const shapeTarget = (t: ToolId): 'room' | 'circulation' | 'obstacle' | null =>
    t === 'room-polygon' || t === 'room-rect' ? 'room' : t === 'circulation' ? 'circulation' : t === 'obstacle' ? 'obstacle' : null;
  const usesRect = (t: ToolId) => t === 'room-rect' || ((t === 'circulation' || t === 'obstacle') && shapeMode === 'rect');

  const selectedPolygon = () => {
    const sel = useUI.getState().selection;
    if (!sel) return null;
    const map = { room: 'rooms', circulation: 'circulation', obstacle: 'obstacles' } as const;
    if (!(sel.kind in map)) return null;
    const k = map[sel.kind as keyof typeof map];
    const item = (project.spatial[k] as { id: string; polygon: Polygon; locked?: boolean }[]).find((x) => x.id === sel.id);
    return item ? { k, item } : null;
  };

  // --- pointer events ----------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    const s = local(e);
    const w = toWorld(s);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const panning = e.button === 1 || spaceDown.current || tool === 'pan' || (e.button === 0 && (tool === 'select' || tool === 'select-staff' || tool === 'inspect'));
    if (e.button === 2) return;
    if (tool === 'edit-polygon' && e.button === 0) {
      const sp = selectedPolygon();
      if (sp && !sp.item.locked) {
        const i = sp.item.polygon.findIndex((v) => dist(v, w) < tolM(8));
        if (i >= 0) {
          if (e.altKey) {
            if (sp.item.polygon.length > 3) {
              editSpatial('Remove vertex', (sm) => ({
                ...sm,
                [sp.k]: (sm[sp.k] as { id: string; polygon: Polygon }[]).map((x) => (x.id === sp.item.id ? { ...x, polygon: x.polygon.filter((_, j) => j !== i) } : x)),
              }));
            }
            return;
          }
          drag.current = { kind: 'vertex', index: i, target: sp.k, id: sp.item.id, original: sp.item.polygon };
          return;
        }
      }
    }
    if (usesRect(tool) && e.button === 0) {
      const a = snapped(w, false).p;
      drag.current = { kind: 'rect', a };
      setDraft({ kind: 'rect', target: shapeTarget(tool)!, a, b: a });
      return;
    }
    if (panning || tool === 'edit-polygon') {
      const v = useView.getState();
      drag.current = { kind: 'pan', start: s, tx: v.tx, ty: v.ty, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = local(e);
    const w = toWorld(s);
    const d = drag.current;
    if (d?.kind === 'pan') {
      const dx = s.x - d.start.x;
      const dy = s.y - d.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.moved) useView.getState().setView({ tx: d.tx + dx, ty: d.ty + dy });
      return;
    }
    if (d?.kind === 'vertex') {
      const sn = snapVertex(project, w, tolM(), d.original);
      const p = sn ?? w;
      setSnap(sn);
      useProject.setState((st) => {
        const pr = st.project!;
        const list = (pr.spatial[d.target] as { id: string; polygon: Polygon }[]).map((x) =>
          x.id === d.id ? { ...x, polygon: x.polygon.map((v, j) => (j === d.index ? p : v)) } : x,
        );
        return { project: { ...pr, spatial: { ...pr.spatial, [d.target]: list } } };
      });
      return;
    }
    if (d?.kind === 'rect') {
      const r = snapped(w, false);
      setSnap(r.snapped);
      setDraft((dr) => (dr?.kind === 'rect' ? { ...dr, b: r.p } : dr));
      return;
    }
    // Hover feedback.
    if (draft?.kind === 'polygon') {
      const last = draft.points[draft.points.length - 1];
      const r = snapped(w, e.shiftKey, last);
      setSnap(r.snapped);
      setDraft({ ...draft, cursor: r.p });
    } else if ((draft?.kind === 'measure' || draft?.kind === 'calibrate' || draft?.kind === 'verify') && !draft.done) {
      if (draft.kind === 'measure') setDraft({ ...draft, b: e.shiftKey ? orthogonal(draft.a, w) : w });
      else {
        const sh = toSheet(w);
        setDraft({ ...draft, b: e.shiftKey ? orthogonal(draft.a, sh) : sh });
      }
    } else if (shapeTarget(tool) || tool === 'door') {
      setSnap(tool === 'door' ? snapEdge(project, w, tolM(14)) : snapVertex(project, w, tolM()));
    } else if (tool === 'select' || tool === 'edit-polygon') {
      const h = hitTestSpatial(project, w, tolM(7), { anchors: useUI.getState().layers.anchors.visible, doors: useUI.getState().layers.doors.visible });
      const cur = useUI.getState().hover;
      if (h?.id !== cur?.id) useUI.getState().setHover(h);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = local(e);
    const w = toWorld(s);
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'vertex') {
      // Commit the drag as a single undoable edit.
      const pr = useProject.getState().project!;
      const finalPoly = (pr.spatial[d.target] as { id: string; polygon: Polygon }[]).find((x) => x.id === d.id)!.polygon;
      useProject.setState((st) => ({
        project: {
          ...st.project!,
          spatial: {
            ...st.project!.spatial,
            [d.target]: (st.project!.spatial[d.target] as { id: string; polygon: Polygon }[]).map((x) => (x.id === d.id ? { ...x, polygon: d.original } : x)),
          },
        },
      }));
      editSpatial('Move vertex', (sm) => ({
        ...sm,
        [d.target]: (sm[d.target] as { id: string; polygon: Polygon }[]).map((x) => (x.id === d.id ? { ...x, polygon: finalPoly } : x)),
      }));
      setSnap(null);
      return;
    }
    if (d?.kind === 'rect') {
      const dr = draft;
      setDraft(null);
      setSnap(null);
      if (dr?.kind === 'rect' && Math.abs(dr.b.x - dr.a.x) > tolM(4) && Math.abs(dr.b.y - dr.a.y) > tolM(4)) {
        finishShape(dr.target, rectPolygon(dr.a.x, dr.a.y, dr.b.x, dr.b.y));
      }
      return;
    }
    if (d?.kind === 'pan' && d.moved) return;
    if (e.button !== 0) return;
    handleClick(s, w, e);
  };

  const handleClick = (s: Vec2, w: Vec2, e: React.PointerEvent) => {
    switch (tool) {
      case 'select':
      case 'edit-polygon': {
        const h = hitTestSpatial(project, w, tolM(7), { anchors: useUI.getState().layers.anchors.visible, doors: useUI.getState().layers.doors.visible });
        select(h);
        return;
      }
      case 'zoom':
        useView.getState().zoomAt(s, e.altKey ? 1 / 1.6 : 1.6);
        return;
      case 'measure': {
        const p = e.shiftKey && draft?.kind === 'measure' && !draft.done ? orthogonal(draft.a, w) : w;
        if (!draft || draft.kind !== 'measure' || draft.done) setDraft({ kind: 'measure', a: p, b: null, done: false });
        else setDraft({ ...draft, b: p, done: true });
        return;
      }
      case 'calibrate':
      case 'verify' as ToolId: {
        const kind = verifyMode.current ? 'verify' : 'calibrate';
        const sh = toSheet(w);
        if (!draft || (draft.kind !== 'calibrate' && draft.kind !== 'verify') || draft.done) setDraft({ kind, a: sh, b: null, done: false });
        else {
          const b = e.shiftKey ? orthogonal(draft.a, sh) : sh;
          if (dist(draft.a, b) < 1e-6) return;
          setDraft({ ...draft, b, done: true });
          setCalInput({ value: Math.round(10 * measureSheet(project.calibration, draft.a, b) / (project.prefs.units === 'ft' ? 0.3048 : 1)) / 10, unit: project.prefs.units });
        }
        return;
      }
      case 'origin': {
        const sh = toSheet(w);
        const cal = project.calibration;
        const next = { ...cal, originSheet: sh };
        const m = compose(sheetToWorld(next), worldToSheet(cal));
        useProject.getState().setCalibrationAndSpatial(next, remapSpatial(project.spatial, m), 'Set origin');
        notify('Origin set. Existing geometry was kept aligned with the drawing.');
        useView.getState().setView(shiftViewFor(m));
        useUI.getState().setTool('select');
        return;
      }
      case 'door': {
        const p = snapEdge(project, w, tolM(14));
        if (!p) {
          notify('Click on a wall (room or corridor edge) to place a door.', 'warn');
          return;
        }
        const id = uid('door');
        addItem('doors', { id, name: `Door ${project.spatial.doors.length + 1}`, position: p, widthM: 0.92, oneWayFromSpaceId: null, locked: false }, 'Place door');
        select({ kind: 'door', id });
        return;
      }
      case 'anchor': {
        const id = uid('anchor');
        const n = project.spatial.anchors.length + 1;
        addItem(
          'anchors',
          { id, label: `A${String(n).padStart(2, '0')}`, position: w, mountingHeightM: 2.6, mountingNotes: '', power: 'battery', status: 'planned', surveyedPosition: null, surveyedZ: null },
          'Place anchor',
        );
        useUI.getState().setLayer('anchors', { visible: true });
        select({ kind: 'anchor', id });
        return;
      }
      case 'room-polygon':
      case 'circulation':
      case 'obstacle': {
        const target = shapeTarget(tool)!;
        const pts = draft?.kind === 'polygon' ? draft.points : [];
        const r = snapped(w, e.shiftKey, pts[pts.length - 1]);
        if (pts.length >= 3 && dist(r.p, pts[0]) < tolM(10)) {
          setDraft(null);
          finishShape(target, pts);
          return;
        }
        setDraft({ kind: 'polygon', target, points: [...pts, r.p], cursor: r.p });
        return;
      }
      default:
        onAnalysisClick?.(w, s, tolM(12), tool);
    }
  };

  /** Keep the plan visually fixed on screen after an origin/scale remap (new = k·old + c). */
  const shiftViewFor = (m: ReturnType<typeof compose>) => {
    const v = useView.getState();
    const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    const scale = v.scale / k;
    return { scale, tx: v.tx - scale * m.e, ty: v.ty - scale * m.f };
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const w = toWorld(local(e));
    if (draft?.kind === 'polygon') {
      // Double-click adds a duplicate final vertex via the preceding click; drop it.
      const pts = draft.points.slice(0, -1);
      if (pts.length >= 3) {
        setDraft(null);
        finishShape(draft.target, pts);
      }
      return;
    }
    if (tool === 'edit-polygon') {
      const sp = selectedPolygon();
      if (!sp || sp.item.locked) return;
      const poly = sp.item.polygon;
      let best = { i: -1, d: Infinity, p: w };
      for (let i = 0; i < poly.length; i++) {
        const c = closestOnSegment(w, poly[i], poly[(i + 1) % poly.length]);
        if (c.d < best.d) best = { i, d: c.d, p: c.point };
      }
      if (best.i >= 0 && best.d < tolM(8)) {
        editSpatial('Insert vertex', (sm) => ({
          ...sm,
          [sp.k]: (sm[sp.k] as { id: string; polygon: Polygon }[]).map((x) =>
            x.id === sp.item.id ? { ...x, polygon: [...x.polygon.slice(0, best.i + 1), best.p, ...x.polygon.slice(best.i + 1)] } : x,
          ),
        }));
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = local(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
    useView.getState().zoomAt(s, factor);
  };

  // Keyboard: Escape, Enter, Backspace, space-to-pan.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      if (e.code === 'Space' && useUI.getState().mode === 'plan') spaceDown.current = true;
      if (e.key === 'Escape') {
        if (draft) setDraft(null);
        else useUI.getState().select(null);
        verifyMode.current = false;
      }
      if (e.key === 'Enter' && draft?.kind === 'polygon' && draft.points.length >= 3) {
        setDraft(null);
        finishShape(draft.target, draft.points);
      }
      if (e.key === 'Backspace' && draft?.kind === 'polygon') {
        e.preventDefault();
        const pts = draft.points.slice(0, -1);
        setDraft(pts.length ? { ...draft, points: pts } : null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  // Calibration verify mode is requested from the Floor Plan panel.
  const verifyMode = useRef(false);
  useEffect(() => {
    viewCommands.startVerify = () => {
      verifyMode.current = true;
      useUI.getState().setTool('calibrate');
      setTimeout(() => (verifyMode.current = true), 0);
    };
  }, []);
  useEffect(() => {
    if (tool !== 'calibrate') verifyMode.current = false;
  }, [tool]);

  const applyCalibration = () => {
    if (draft?.kind !== 'calibrate' || !draft.b) return;
    const old = project.calibration;
    try {
      const next = calibrate(old, draft.a, draft.b, calInput.value, calInput.unit);
      const m = compose(sheetToWorld(next), worldToSheet(old));
      useProject.getState().setCalibrationAndSpatial(next, remapSpatial(project.spatial, m), 'Calibrate scale');
      useView.getState().setView(shiftViewFor(m));
      notify(`Scale calibrated: ${(next.metersPerUnit * 72 / 0.3048).toFixed(3)} ft per inch on sheet. Verify with a second dimension.`);
      setDraft(null);
      useUI.getState().setTool('select');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    }
  };
  const applyVerification = () => {
    if (draft?.kind !== 'verify' || !draft.b) return;
    const cal = project.calibration;
    const measured = measureSheet(cal, draft.a, draft.b);
    const known = toMeters(calInput.value, calInput.unit);
    const v = { id: uid('ver'), a: draft.a, b: draft.b, knownDistanceM: known, measuredDistanceM: measured, date: new Date().toISOString() };
    useProject.getState().setCalibrationAndSpatial({ ...cal, verifications: [...cal.verifications, v] }, project.spatial, 'Verify calibration');
    const err = Math.abs(measured - known) / known;
    notify(`Verification: measured ${measured.toFixed(2)} m vs known ${known.toFixed(2)} m (${(err * 100).toFixed(1)}% difference).`, err > 0.02 ? 'warn' : 'info');
    setDraft(null);
    verifyMode.current = false;
    useUI.getState().setTool('select');
  };

  const cursor =
    tool === 'pan' ? 'grab' : tool === 'zoom' ? 'zoom-in' : tool === 'select' || tool === 'select-staff' ? 'default' : tool === 'edit-polygon' ? 'default' : 'crosshair';

  const def = toolById(tool);
  const calDialog = draft && (draft.kind === 'calibrate' || draft.kind === 'verify') && draft.done;

  return (
    <div
      ref={host}
      className="relative h-full w-full overflow-hidden bg-canvas"
      style={{ cursor, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => useUI.getState().setHover(null)}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="floor-plan"
    >
      <PdfLayer />
      <GeometryLayer roomFill={roomFill} />
      {dynamicLayers}
      <OverlayLayer draft={draft} snap={snap} />
      {/* Tool hint */}
      {def.editing || draft ? (
        <div className="pointer-events-none absolute bottom-14 left-1/2 z-10 max-w-[640px] -translate-x-1/2 rounded-[3px] bg-ink/90 px-3 py-1.5 text-center text-[12px] text-white shadow-sm">
          <span className="font-semibold">{verifyMode.current ? 'Verify calibration' : def.label}:</span> {verifyMode.current ? 'Click both ends of a second known dimension.' : def.hint}
        </div>
      ) : null}
      {calDialog && (
        <div className="absolute top-14 left-1/2 z-20 w-[320px] -translate-x-1/2 rounded-[4px] border border-line bg-paper p-3 shadow-lg" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <div className="mb-2 text-[12.5px] font-semibold">{draft.kind === 'calibrate' ? 'Known distance between points' : 'Known length of verification dimension'}</div>
          <div className="flex gap-2">
            <NumberInput className="flex-1" value={calInput.value} min={0.001} step={0.1} onCommit={(v) => setCalInput({ ...calInput, value: v ?? calInput.value })} />
            <Segmented value={calInput.unit} onChange={(u) => setCalInput({ ...calInput, unit: u })} options={[{ value: 'ft', label: 'ft' }, { value: 'm', label: 'm' }]} />
          </div>
          <div className="mt-1.5 text-2xs text-muted">Sheet distance: {dist(draft.a, draft.b!).toFixed(1)} pt. Use decimal feet (e.g. 12.5 for 12'-6").</div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={draft.kind === 'calibrate' ? applyCalibration : applyVerification}>
              {draft.kind === 'calibrate' ? 'Apply calibration' : 'Record verification'}
            </Button>
          </div>
        </div>
      )}
      {hud}
    </div>
  );
}

/** Imperative view commands (set by the mounted FloorPlanView). */
export const viewCommands: {
  fitPlan: () => void;
  fitPage: () => void;
  fitSelection: () => void;
  startVerify: () => void;
} = { fitPlan: () => {}, fitPage: () => {}, fitSelection: () => {}, startVerify: () => {} };
