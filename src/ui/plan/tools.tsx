import type { ReactNode } from 'react';
import {
  Crosshair,
  DoorOpen,
  Hand,
  LocateFixed,
  MousePointer2,
  OctagonX,
  Pentagon,
  RadioTower,
  Ruler,
  ScanSearch,
  Spline,
  Square,
  UserRound,
  Waypoints,
  ZoomIn,
} from 'lucide-react';
import type { AppMode, ToolId } from '@/store/uiStore';

export interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  icon: ReactNode;
  hint: string;
  modes: AppMode[];
  /** Tool modifies geometry. */
  editing?: boolean;
}

const I = 15;

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', key: 'V', icon: <MousePointer2 size={I} />, hint: 'Click to select. Drag to pan. Scroll to zoom.', modes: ['plan', 'configure', 'explore', 'analyze'] },
  { id: 'pan', label: 'Pan', key: 'H', icon: <Hand size={I} />, hint: 'Drag to pan. Scroll to zoom.', modes: ['plan', 'configure', 'explore', 'analyze', 'present'] },
  { id: 'zoom', label: 'Zoom', key: 'Z', icon: <ZoomIn size={I} />, hint: 'Click to zoom in, Alt+click to zoom out.', modes: ['plan', 'explore', 'analyze', 'present'] },
  { id: 'measure', label: 'Measure', key: 'M', icon: <Ruler size={I} />, hint: 'Click two points to measure. Shift constrains to horizontal/vertical.', modes: ['plan', 'explore', 'analyze'] },
  { id: 'select-staff', label: 'Select staff', key: 'S', icon: <UserRound size={I} />, hint: 'Click a staff marker to review its movement.', modes: ['explore', 'analyze'] },
  { id: 'inspect', label: 'Inspect data point', key: 'I', icon: <ScanSearch size={I} />, hint: 'Click near a trajectory to inspect the closest recorded sample in the current time window.', modes: ['explore', 'analyze'] },
  { id: 'calibrate', label: 'Calibrate scale', key: 'K', icon: <Crosshair size={I} />, hint: 'Click both ends of a known dimension on the drawing, then enter its real length.', modes: ['plan'], editing: true },
  { id: 'origin', label: 'Set origin', key: 'G', icon: <LocateFixed size={I} />, hint: 'Click the point to use as the building coordinate origin (0,0). Geometry stays aligned.', modes: ['plan'], editing: true },
  { id: 'room-rect', label: 'Rectangle room', key: 'R', icon: <Square size={I} />, hint: 'Drag corner to corner to create a rectangular room. Corners snap to existing vertices.', modes: ['plan'], editing: true },
  { id: 'room-polygon', label: 'Polygon room', key: 'P', icon: <Pentagon size={I} />, hint: 'Click vertices around the room. Click the first point, double-click or press Enter to close. Backspace undoes a point. Shift = orthogonal.', modes: ['plan'], editing: true },
  { id: 'edit-polygon', label: 'Edit vertices', key: 'E', icon: <Spline size={I} />, hint: 'Select a shape, then drag vertices. Double-click an edge to add a vertex; Alt+click a vertex to remove it.', modes: ['plan'], editing: true },
  { id: 'door', label: 'Place door', key: 'D', icon: <DoorOpen size={I} />, hint: 'Click on a wall shared by two spaces to place a door / opening.', modes: ['plan'], editing: true },
  { id: 'circulation', label: 'Circulation', key: 'C', icon: <Waypoints size={I} />, hint: 'Draw walkable corridor areas (rectangle or polygon, see options). Overlapping/abutting areas connect.', modes: ['plan'], editing: true },
  { id: 'obstacle', label: 'Obstacle', key: 'O', icon: <OctagonX size={I} />, hint: 'Draw a non-walkable obstacle (casework, equipment, columns).', modes: ['plan'], editing: true },
  { id: 'anchor', label: 'Place anchor', key: 'A', icon: <RadioTower size={I} />, hint: 'Click to place a planned UWB anchor. Circles are NOT radio coverage.', modes: ['plan'], editing: true },
];

export const toolById = (id: ToolId) => TOOLS.find((t) => t.id === id)!;
