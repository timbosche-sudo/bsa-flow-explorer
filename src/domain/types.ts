/**
 * Core data model for BSA Flow Explorer.
 *
 * COORDINATE SYSTEMS
 * ------------------
 *  - "Sheet" coordinates: PDF page units (points, 1/72 in) measured on the
 *    unrotated page as rendered by PDF.js at scale 1, origin top-left, y down.
 *  - "World" coordinates: calibrated building space in METERS, origin at the
 *    user-defined drawing origin, x to the right, y DOWN (screen-aligned plan
 *    north up). All geometry, trajectories and analytics use world meters.
 *  - "Screen" coordinates: CSS pixels inside the floor plan viewport.
 *
 * The Calibration object maps sheet -> world. The view transform maps
 * world -> screen. Imported tracking data is mapped from its own reference
 * frame into world coordinates by a CoordinateFrame transform.
 */

export type Vec2 = { x: number; y: number };
/** Closed polygon ring, implicitly closed (last vertex != first). */
export type Polygon = Vec2[];

export type ID = string;

export type LengthUnit = 'ft' | 'm';

// ---------------------------------------------------------------------------
// Floor plan & calibration
// ---------------------------------------------------------------------------

export interface FloorPlanSource {
  /** Key of the stored PDF blob in the local project store (IndexedDB). */
  blobKey: ID | null;
  /** Bundled URL for demonstration drawings (sample clinic). */
  bundledUrl?: string;
  fileName: string | null;
  pageCount: number;
  pageIndex: number; // 0-based
  /** Page size in sheet units (points) for the selected page. */
  pageWidth: number;
  pageHeight: number;
  opacity: number; // 0..1
  visible: boolean;
  /** Render drawing in grayscale / muted for analysis overlays. */
  muted: boolean;
}

export interface VerificationMeasurement {
  id: ID;
  a: Vec2; // sheet coordinates
  b: Vec2;
  knownDistanceM: number;
  measuredDistanceM: number;
  date: string; // ISO
}

export interface Calibration {
  /** True once a two-point calibration has been accepted. */
  calibrated: boolean;
  /** Reference points in sheet coordinates. */
  pointA: Vec2 | null;
  pointB: Vec2 | null;
  /** Known real-world distance between A and B, meters. */
  knownDistanceM: number | null;
  /** Unit in which the user entered the known distance. */
  enteredUnit: LengthUnit;
  /** Meters per sheet unit. Uncalibrated default assumes 1/8" = 1'-0". */
  metersPerUnit: number;
  /** World origin expressed in sheet coordinates. */
  originSheet: Vec2;
  /** Rotation (deg) applied from sheet axes to world axes. */
  rotationDeg: number;
  date: string | null;
  verifications: VerificationMeasurement[];
}

// ---------------------------------------------------------------------------
// Spatial definition
// ---------------------------------------------------------------------------

export const DEFAULT_ROOM_TYPES = [
  'Exam Room',
  'Procedure Room',
  'Nurse Station',
  'Medical Assistant Workstation',
  'Physician Workroom',
  'Medication Room',
  'Clean Supply',
  'Soiled Utility',
  'Equipment Storage',
  'Staff Lounge',
  'Reception',
  'Waiting',
  'Patient Toilet',
  'Staff Toilet',
  'Laboratory',
  'Treatment',
  'Corridor',
  'Other',
] as const;

export type RoomType = string;

export interface RoomTypeDef {
  name: RoomType;
  color: string; // hex
  /** Circulation-like spaces are excluded from origin/destination trips. */
  isCirculation: boolean;
  custom: boolean;
}

export interface Room {
  id: ID;
  name: string;
  number: string;
  type: RoomType;
  department: string;
  zoneId: ID | null;
  polygon: Polygon; // world meters
  /** Optional user-placed activity point (where people stand / work). */
  activityPoint: Vec2 | null;
  notes: string;
  targetOccupancy: number | null;
  plannedUtilization: string;
  color: string | null; // overrides type color
  locked: boolean;
  /** No through-traffic: route may start/end here but never pass through. */
  restricted: boolean;
  staffOnly: boolean;
  /** Excluded from visualizations and client-facing outputs (privacy). */
  sensitive: boolean;
}

export interface Door {
  id: ID;
  name: string;
  position: Vec2; // world meters, on the shared wall
  widthM: number;
  /** Optional one-way traversal: only from `fromSpaceId` into the other space. */
  oneWayFromSpaceId: ID | null;
  locked: boolean;
}

export interface CirculationArea {
  id: ID;
  name: string;
  polygon: Polygon;
  /** Walkable but not counted as a room. Overlapping circulation merges freely. */
  locked: boolean;
}

export interface Obstacle {
  id: ID;
  name: string;
  polygon: Polygon;
}

export interface Zone {
  id: ID;
  name: string;
  color: string;
}

export type AnchorPower = 'battery' | 'mains' | 'poe' | 'usb' | 'unknown';
export type AnchorStatus = 'planned' | 'installed' | 'surveyed' | 'removed';

export interface Anchor {
  id: ID;
  label: string;
  position: Vec2; // planned world position
  mountingHeightM: number | null;
  mountingNotes: string;
  power: AnchorPower;
  status: AnchorStatus;
  /** Measured survey coordinates (world meters), if surveyed. */
  surveyedPosition: Vec2 | null;
  surveyedZ: number | null;
}

export interface SpatialModel {
  rooms: Room[];
  doors: Door[];
  circulation: CirculationArea[];
  obstacles: Obstacle[];
  zones: Zone[];
  anchors: Anchor[];
}

// ---------------------------------------------------------------------------
// Staff & simulation
// ---------------------------------------------------------------------------

/** Triangular distribution, minutes. */
export interface DurationDist {
  min: number;
  mode: number;
  max: number;
}

export interface ActivityDef {
  id: ID;
  label: string;
  /** Candidate destination room types. */
  destinationTypes: RoomType[];
  /** Relative selection weight. */
  weight: number;
  dwell: DurationDist;
  /** Probability of chaining directly to another task without returning to base. */
  chainProbability: number;
}

export interface BreakDef {
  id: ID;
  label: string;
  /** Earliest / latest start, minutes after shift start. */
  earliestMin: number;
  latestMin: number;
  durationMin: number;
  destinationTypes: RoomType[];
}

export interface StaffRole {
  id: ID;
  name: string;
  shortName: string;
  color: string;
  custom: boolean;
  /** Room types used as home base. */
  homeBaseTypes: RoomType[];
  /** Time spent at home base between tasks. */
  homeDwell: DurationDist;
  activities: ActivityDef[];
  breaks: BreakDef[];
  walkingSpeedMps: number;
  walkingSpeedSd: number;
  /** 0 = destinations chosen uniformly; higher = strongly prefer nearby rooms. */
  locality: number;
  /** Shift start/end variation (standard deviation, minutes). */
  shiftVariationMin: number;
}

export interface StaffMember {
  id: ID;
  /** Pseudonymous identifier, e.g. RN-01. Never an employee name. */
  code: string;
  roleId: ID;
  /** Optional fixed home-base room; otherwise nearest of role's base types. */
  homeRoomId: ID | null;
  shiftStartMin: number; // minutes after midnight
  shiftEndMin: number;
  /** Tag ID for observed data association. */
  tagId: string | null;
}

export interface PeakPeriod {
  id: ID;
  label: string;
  startMin: number; // minutes after midnight
  endMin: number;
  /** >1 shortens base dwell, increasing movement frequency. */
  intensity: number;
}

export interface SimulationConfig {
  seed: number;
  studyStartMin: number; // minutes after midnight
  studyEndMin: number;
  /** Simulated date (for timestamps). */
  studyDate: string; // YYYY-MM-DD
  /** Output sample interval, seconds (positions emitted at least this often). */
  sampleIntervalS: number;
  peakPeriods: PeakPeriod[];
  /** Random offset radius around activity points, meters. */
  positionJitterM: number;
}

// ---------------------------------------------------------------------------
// Movement data (common to simulated and observed)
// ---------------------------------------------------------------------------

export type DatasetKind = 'simulated' | 'observed';

/**
 * A time-ordered track for one tag / person. Times are seconds since the
 * study day's midnight (local study time); positions are world meters.
 * Samples may be irregular; `gap` marks samples that start a new contiguous
 * segment (no interpolation across them).
 */
export interface Track {
  staffId: ID;
  roleId: ID | null;
  t: Float64Array;
  x: Float32Array;
  y: Float32Array;
  /** 1 where a tracking gap precedes this sample. */
  gap: Uint8Array;
}

export type ProvenanceStep = {
  date: string;
  action: string;
  detail: string;
};

export interface DatasetMeta {
  id: ID;
  name: string;
  kind: DatasetKind;
  createdAt: string;
  /** Study day this dataset represents. */
  studyDate: string;
  source: string; // e.g. "Simulation engine v1 seed 1234" or file names
  coordinateFrameId: ID | null;
  provenance: ProvenanceStep[];
  /** Approximate positional accuracy (m) if known; null = unknown. */
  positionAccuracyM: number | null;
  /** Imported file is synthetic/test data rather than a field recording. */
  synthetic?: boolean;
  /** Study-site offset from UTC used to convert timestamps (minutes). */
  utcOffsetMin?: number;
}

/** Ground-truth activity log produced only by the simulation engine. */
export interface SimActivitySpan {
  staffId: ID;
  startS: number;
  endS: number;
  kind: 'walk' | 'dwell' | 'off';
  label: string; // activity label (simulated only)
  roomId: ID | null; // dwell room or destination room for walks
  fromRoomId: ID | null;
  distanceM: number; // for walks
}

export interface SimulationResult {
  meta: DatasetMeta;
  tracks: Track[];
  spans: SimActivitySpan[];
  warnings: string[];
  configHash: string;
}

// ---------------------------------------------------------------------------
// Observed data import
// ---------------------------------------------------------------------------

/** Transform from an external positioning reference frame into world meters. */
export interface CoordinateFrame {
  id: ID;
  name: string;
  /** Units of the incoming coordinates. */
  unit: LengthUnit;
  /** World position of incoming origin (meters). */
  offset: Vec2;
  rotationDeg: number;
  /** Incoming y axis points up (typical engineering frame) -> flip to world y-down. */
  flipY: boolean;
}

export interface PositionObservation {
  studyId: string;
  tagId: string;
  timestampUtc: string; // ISO 8601
  x: number; // meters in the coordinate frame
  y: number;
  z?: number | null;
  frameId: string;
  source: string; // e.g. "uwb-twr", "uwb-tdoa", "manual"
  quality?: number | null; // 0..1 or vendor-specific
  uncertaintyM?: number | null;
  diagnostics?: Record<string, unknown>;
}

/** Raw UWB ranging measurement (anchor <-> tag). Not a position. */
export interface RangeObservation {
  studyId: string;
  tagId: string;
  anchorId: string;
  timestampUtc: string;
  rangeM: number;
  rssiDbm?: number | null;
  firstPathDbm?: number | null;
  quality?: number | null;
}

export interface ObservedDataset {
  meta: DatasetMeta;
  /** Raw imported observations, preserved unmodified (world-mapped copy is derived). */
  rawTracks: Track[];
  /** Cleaned trajectories used for analytics. */
  cleanTracks: Track[];
  tagRoles: Record<string, ID | null>;
  /** Filtering decisions, recorded for provenance. */
  qualityReport: QualityReport;
}

export interface QualityReport {
  totalRecords: number;
  importedRecords: number;
  issues: { code: string; count: number; description: string; action: string }[];
  thresholds: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface ProjectMeta {
  id: ID;
  name: string;
  facilityName: string;
  description: string;
  studyArea: string;
  date: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** User acknowledged field-study governance requirements. */
  governanceAcknowledged: boolean;
  isSample: boolean;
}

export interface VisualizationPrefs {
  units: LengthUnit;
  showGrid: boolean;
  showScaleBar: boolean;
  /** Minimum number of staff in a group before group results are reported. */
  minGroupSize: number;
}

export interface Project {
  schemaVersion: number;
  meta: ProjectMeta;
  floorPlan: FloorPlanSource;
  calibration: Calibration;
  spatial: SpatialModel;
  roomTypes: RoomTypeDef[];
  roles: StaffRole[];
  staff: StaffMember[];
  simulation: SimulationConfig;
  coordinateFrames: CoordinateFrame[];
  /** Metadata for imported observed datasets (tracks stored separately). */
  observedDatasetIds: ID[];
  prefs: VisualizationPrefs;
}

export const CURRENT_SCHEMA_VERSION = 1;
