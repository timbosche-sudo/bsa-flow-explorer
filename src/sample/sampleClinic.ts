/**
 * Fictional demonstration clinic.
 *
 * A plausible single-floor ambulatory clinic used to demonstrate the
 * application. It is NOT a real facility and NOT a validated design.
 * Geometry is in world meters (x right, y down). The bundled PDF drawing
 * (public/sample/sample-clinic.pdf) is generated from this same geometry by
 * scripts/generateSamplePdf.ts at 1/8" = 1'-0" on an ARCH D sheet.
 */
import type {
  Anchor,
  CirculationArea,
  Door,
  Obstacle,
  Project,
  Room,
  SpatialModel,
  StaffMember,
  Zone,
} from '@/domain/types';
import { CURRENT_SCHEMA_VERSION } from '@/domain/types';
import { defaultPrefs, defaultRoles, defaultRoomTypes, defaultSimulationConfig } from '@/domain/defaults';
import { rectPolygon } from '@/geometry/polygon';
import { M_PER_FT } from '@/geometry/calibration';

/** Sheet layout of the generated sample PDF (points). */
export const SAMPLE_PDF = {
  url: 'sample/sample-clinic.pdf',
  pageWidth: 36 * 72, // ARCH D landscape
  pageHeight: 24 * 72,
  /** 1/8" = 1'-0" -> 9 pt per foot. */
  metersPerPoint: M_PER_FT / 9,
  /** Sheet position of the world origin (building's top-left corner). */
  originSheet: { x: 600, y: 560 },
  /** Calibration dimension drawn on the sheet: overall building width. */
  calibrationWorldA: { x: 0, y: -2.2 },
  calibrationWorldB: { x: 46, y: -2.2 },
};

const ZONES: Zone[] = [
  { id: 'zone-public', name: 'Public / Front of House', color: '#a7ad92' },
  { id: 'zone-pod-n', name: 'Exam Pod North', color: '#7f9db4' },
  { id: 'zone-pod-s', name: 'Exam Pod South', color: '#8ea2c2' },
  { id: 'zone-core', name: 'Clinical Support Core', color: '#c48a5a' },
  { id: 'zone-staff', name: 'Staff Support', color: '#b5a77d' },
];

type RoomSpec = {
  id: string;
  name: string;
  number: string;
  type: string;
  zone: string;
  rect?: [number, number, number, number];
  poly?: [number, number][];
  restricted?: boolean;
  sensitive?: boolean;
};

const N0 = 0;
const N1 = 3.6; // north row
const C0 = 5.6; // core top (north corridor 3.6..5.6)
const CM = 9.2; // core mid
const C1 = 12.8; // core bottom
const S0 = 14.8; // south row top (south corridor 12.8..14.8)
const S1 = 18.4;

function examRooms(): RoomSpec[] {
  const rooms: RoomSpec[] = [];
  for (let i = 0; i < 6; i++) {
    const x = 11.4 + i * 3.2;
    rooms.push({ id: `room-exam-${101 + i}`, name: 'Exam', number: `${101 + i}`, type: 'Exam Room', zone: 'zone-pod-n', rect: [x, N0, x + 3.2, N1] });
  }
  for (let i = 0; i < 6; i++) {
    const x = 13.4 + i * 3.2;
    rooms.push({ id: `room-exam-${107 + i}`, name: 'Exam', number: `${107 + i}`, type: 'Exam Room', zone: 'zone-pod-s', rect: [x, S0, x + 3.2, S1] });
  }
  return rooms;
}

const ROOM_SPECS: RoomSpec[] = [
  { id: 'room-waiting', name: 'Waiting', number: '100', type: 'Waiting', zone: 'zone-public', rect: [0, 0, 9, 9] },
  {
    id: 'room-reception',
    name: 'Reception',
    number: '100A',
    type: 'Reception',
    zone: 'zone-public',
    // L-shaped (non-convex) to exercise routing inside irregular rooms.
    poly: [
      [3.2, 9],
      [9, 9],
      [9, S0],
      [0, S0],
      [0, 12],
      [3.2, 12],
    ],
  },
  { id: 'room-ptoilet-1', name: 'Patient Toilet', number: '100B', type: 'Patient Toilet', zone: 'zone-public', rect: [0, 9, 3.2, 12], sensitive: true },
  { id: 'room-stoilet-1', name: 'Staff Toilet', number: '120', type: 'Staff Toilet', zone: 'zone-staff', rect: [9, N0, 11.4, N1], sensitive: true },
  ...examRooms(),
  { id: 'room-proc-1', name: 'Procedure', number: '113', type: 'Procedure Room', zone: 'zone-pod-n', rect: [30.6, N0, 35.2, N1] },
  { id: 'room-proc-2', name: 'Procedure', number: '114', type: 'Procedure Room', zone: 'zone-pod-n', rect: [35.2, N0, 39.8, N1] },
  { id: 'room-soiled', name: 'Soiled Utility', number: '130', type: 'Soiled Utility', zone: 'zone-core', rect: [39.8, N0, 43, N1], restricted: true },
  { id: 'room-ptoilet-2', name: 'Patient Toilet', number: '131', type: 'Patient Toilet', zone: 'zone-pod-n', rect: [43, N0, 46, N1], sensitive: true },
  { id: 'room-lab', name: 'Laboratory', number: '140', type: 'Laboratory', zone: 'zone-core', rect: [9, S0, 13.4, S1] },
  { id: 'room-lounge', name: 'Staff Lounge', number: '150', type: 'Staff Lounge', zone: 'zone-staff', rect: [32.6, S0, 38.6, S1] },
  { id: 'room-phys', name: 'Physician Workroom', number: '151', type: 'Physician Workroom', zone: 'zone-staff', rect: [38.6, S0, 46, S1] },
  { id: 'room-ma-1', name: 'MA Work Area', number: '121', type: 'Medical Assistant Workstation', zone: 'zone-core', rect: [11, C0, 16, CM] },
  { id: 'room-meds', name: 'Medication', number: '122', type: 'Medication Room', zone: 'zone-core', rect: [16, C0, 21, CM], restricted: true },
  { id: 'room-clean', name: 'Clean Supply', number: '123', type: 'Clean Supply', zone: 'zone-core', rect: [11, CM, 16, C1], restricted: true },
  { id: 'room-treat', name: 'Treatment', number: '124', type: 'Treatment', zone: 'zone-core', rect: [16, CM, 21, C1] },
  { id: 'room-ns', name: 'Nurse Station', number: '125', type: 'Nurse Station', zone: 'zone-core', rect: [21, C0, 30, C1] },
  { id: 'room-ma-2', name: 'MA Work Area', number: '126', type: 'Medical Assistant Workstation', zone: 'zone-core', rect: [30, C0, 35, C1] },
  { id: 'room-huddle', name: 'Huddle / Conference', number: '127', type: 'Other', zone: 'zone-staff', rect: [35, C0, 44, CM] },
  { id: 'room-equip', name: 'Equipment Storage', number: '128', type: 'Equipment Storage', zone: 'zone-core', rect: [35, CM, 44, C1], restricted: true },
];

function makeRoom(s: RoomSpec): Room {
  const polygon = s.rect ? rectPolygon(...s.rect) : s.poly!.map(([x, y]) => ({ x, y }));
  return {
    id: s.id,
    name: s.name,
    number: s.number,
    type: s.type,
    department: 'Ambulatory Clinic (fictional)',
    zoneId: s.zone,
    polygon,
    activityPoint: null,
    notes: '',
    targetOccupancy: null,
    plannedUtilization: '',
    color: null,
    locked: false,
    restricted: s.restricted ?? false,
    staffOnly: s.zone !== 'zone-public',
    sensitive: s.sensitive ?? false,
  };
}

const CIRCULATION: CirculationArea[] = [
  { id: 'circ-north', name: 'North Corridor', polygon: rectPolygon(9, N1, 46, C0), locked: false },
  { id: 'circ-south', name: 'South Corridor', polygon: rectPolygon(9, C1, 46, S0), locked: false },
  { id: 'circ-west', name: 'West Connector', polygon: rectPolygon(9, C0, 11, C1), locked: false },
  { id: 'circ-east', name: 'East Connector', polygon: rectPolygon(44, C0, 46, C1), locked: false },
];

const OBSTACLES: Obstacle[] = [
  // Central work counter inside the open nurse station.
  { id: 'obs-ns-counter', name: 'Nurse station counter', polygon: rectPolygon(23.5, 8.2, 27.5, 10.2) },
];

function door(id: string, name: string, x: number, y: number, widthM = 1.0): Door {
  return { id, name, position: { x, y }, widthM, oneWayFromSpaceId: null, locked: false };
}

function makeDoors(): Door[] {
  const doors: Door[] = [
    door('door-waiting', 'Waiting → Corridor', 9, 4.6, 1.2),
    door('door-reception-wait', 'Reception → Waiting', 7.4, 9),
    door('door-reception-corr', 'Reception → West Connector', 9, 11),
    door('door-ptoilet-1', 'Patient Toilet', 1.6, 9, 0.95),
    door('door-stoilet-1', 'Staff Toilet', 10.2, N1, 0.9),
    door('door-proc-1', 'Procedure 113', 31.6, N1, 1.2),
    door('door-proc-2', 'Procedure 114', 36.2, N1, 1.2),
    door('door-soiled', 'Soiled Utility', 41.4, N1),
    door('door-ptoilet-2', 'Patient Toilet 131', 44.5, N1, 0.95),
    door('door-lab', 'Laboratory', 11.6, S0),
    door('door-lounge', 'Staff Lounge', 34, S0),
    door('door-phys', 'Physician Workroom', 40, S0),
    door('door-ma-1', 'MA Work Area 121', 13.5, C0),
    door('door-meds', 'Medication', 18.5, C0),
    door('door-clean', 'Clean Supply', 13.5, C1),
    door('door-treat', 'Treatment', 18.5, C1),
    door('door-ns-n', 'Nurse Station (north opening)', 25.5, C0, 3),
    door('door-ns-s', 'Nurse Station (south opening)', 25.5, C1, 3),
    door('door-ma-2-n', 'MA Work Area 126 (north)', 32.5, C0),
    door('door-ma-2-s', 'MA Work Area 126 (south)', 32.5, C1),
    door('door-huddle', 'Huddle', 39.5, C0),
    door('door-equip', 'Equipment Storage', 39.5, C1, 1.2),
  ];
  for (let i = 0; i < 6; i++) {
    doors.push(door(`door-exam-${101 + i}`, `Exam ${101 + i}`, 11.4 + i * 3.2 + 2.4, N1));
    doors.push(door(`door-exam-${107 + i}`, `Exam ${107 + i}`, 13.4 + i * 3.2 + 0.8, S0));
  }
  return doors;
}

function makeAnchors(): Anchor[] {
  const pts: [number, number][] = [
    [9.6, 4.0],
    [18, 4.0],
    [27, 4.0],
    [36, 4.0],
    [45.4, 4.0],
    [9.6, 14.4],
    [18, 14.4],
    [27, 14.4],
    [36, 14.4],
    [45.4, 14.4],
    [4.5, 0.5],
    [25.5, 6.2],
  ];
  return pts.map(([x, y], i) => ({
    id: `anchor-${i + 1}`,
    label: `A${String(i + 1).padStart(2, '0')}`,
    position: { x, y },
    mountingHeightM: 2.6,
    mountingNotes: 'Ceiling / high wall mount (planning assumption)',
    power: 'battery',
    status: 'planned',
    surveyedPosition: null,
    surveyedZ: null,
  }));
}

export function sampleSpatialModel(): SpatialModel {
  return {
    rooms: ROOM_SPECS.map(makeRoom),
    doors: makeDoors(),
    circulation: CIRCULATION.map((c) => ({ ...c, polygon: c.polygon.map((p) => ({ ...p })) })),
    obstacles: OBSTACLES.map((o) => ({ ...o, polygon: o.polygon.map((p) => ({ ...p })) })),
    zones: ZONES.map((z) => ({ ...z })),
    anchors: makeAnchors(),
  };
}

function sampleStaff(): StaffMember[] {
  const s = (code: string, roleId: string, homeRoomId: string | null, startH: number, endH: number): StaffMember => ({
    id: `staff-${code.toLowerCase()}`,
    code,
    roleId,
    homeRoomId,
    shiftStartMin: startH * 60,
    shiftEndMin: endH * 60,
    tagId: `TAG-${code}`,
  });
  return [
    s('RN-01', 'role-rn', 'room-ns', 8, 16),
    s('RN-02', 'role-rn', 'room-ns', 8, 16),
    s('RN-03', 'role-rn', 'room-ns', 8, 16),
    s('MA-01', 'role-ma', 'room-ma-1', 8, 16),
    s('MA-02', 'role-ma', 'room-ma-1', 8, 16),
    s('MA-03', 'role-ma', 'room-ma-2', 8, 16),
    s('MD-01', 'role-md', 'room-phys', 8.25, 16),
    s('MD-02', 'role-md', 'room-phys', 8.5, 16),
    s('TECH-01', 'role-tech', 'room-lab', 8, 16),
    s('ADM-01', 'role-admin', 'room-reception', 8, 16),
  ];
}

export const SAMPLE_PROJECT_ID = 'sample-clinic';

export function createSampleProject(): Project {
  const now = new Date().toISOString();
  const worldToSheet = (p: { x: number; y: number }) => ({
    x: SAMPLE_PDF.originSheet.x + p.x / SAMPLE_PDF.metersPerPoint,
    y: SAMPLE_PDF.originSheet.y + p.y / SAMPLE_PDF.metersPerPoint,
  });
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: {
      id: SAMPLE_PROJECT_ID,
      name: 'Sample Ambulatory Clinic',
      facilityName: 'Fictional Ambulatory Clinic (demonstration)',
      description:
        'Demonstration study using a fictional clinic layout and simulated staff movement. Not a real facility; not a validated design; not measured evidence.',
      studyArea: 'Level 1 — clinic suite',
      date: '2025-03-12',
      notes: 'All movement in this project is SIMULATED DATA — DEMONSTRATION ONLY.',
      createdAt: now,
      updatedAt: now,
      governanceAcknowledged: true,
      isSample: true,
    },
    floorPlan: {
      blobKey: null,
      bundledUrl: SAMPLE_PDF.url,
      fileName: 'sample-clinic.pdf',
      pageCount: 1,
      pageIndex: 0,
      pageWidth: SAMPLE_PDF.pageWidth,
      pageHeight: SAMPLE_PDF.pageHeight,
      opacity: 1,
      visible: true,
      muted: false,
    },
    calibration: {
      calibrated: true,
      pointA: worldToSheet(SAMPLE_PDF.calibrationWorldA),
      pointB: worldToSheet(SAMPLE_PDF.calibrationWorldB),
      knownDistanceM: 46,
      enteredUnit: 'm',
      metersPerUnit: SAMPLE_PDF.metersPerPoint,
      originSheet: { ...SAMPLE_PDF.originSheet },
      rotationDeg: 0,
      date: now,
      verifications: [],
    },
    spatial: sampleSpatialModel(),
    roomTypes: defaultRoomTypes(),
    roles: defaultRoles(),
    staff: sampleStaff(),
    simulation: defaultSimulationConfig(),
    coordinateFrames: [
      { id: 'frame-world', name: 'Building world frame (meters, y down)', unit: 'm', offset: { x: 0, y: 0 }, rotationDeg: 0, flipY: false },
    ],
    observedDatasetIds: [],
    prefs: defaultPrefs(),
  };
}
