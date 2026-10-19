import type { RoomTypeDef, SimulationConfig, StaffRole, VisualizationPrefs } from './types';
import { DEFAULT_ROOM_TYPES } from './types';

let counter = 0;
/** Locally unique id. Uses crypto.randomUUID when available. */
export function uid(prefix = 'id'): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `${prefix}-${c.randomUUID().slice(0, 8)}`;
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

const TYPE_COLORS: Record<string, string> = {
  'Exam Room': '#7f9db4',
  'Procedure Room': '#6b8aa6',
  'Nurse Station': '#c48a5a',
  'Medical Assistant Workstation': '#c9a26b',
  'Physician Workroom': '#a68bb0',
  'Medication Room': '#b97874',
  'Clean Supply': '#7fae9a',
  'Soiled Utility': '#9b8f78',
  'Equipment Storage': '#8f9aa3',
  'Staff Lounge': '#b5a77d',
  Reception: '#9fa889',
  Waiting: '#b3b9a4',
  'Patient Toilet': '#a3b2bb',
  'Staff Toilet': '#a3b2bb',
  Laboratory: '#86a9a9',
  Treatment: '#8ea2c2',
  Corridor: '#d6d3cd',
  Other: '#a9a6a0',
};

export function defaultRoomTypes(): RoomTypeDef[] {
  return DEFAULT_ROOM_TYPES.map((name) => ({
    name,
    color: TYPE_COLORS[name] ?? '#a9a6a0',
    isCirculation: name === 'Corridor',
    custom: false,
  }));
}

/** Distinguishable, restrained role palette (colour-blind aware ordering). */
export const ROLE_PALETTE = ['#2f6f9f', '#d07a2d', '#4f8f5b', '#8a5aa8', '#c0443c', '#2a9d9a', '#9c7a2b', '#6b6f76'];

const tri = (min: number, mode: number, max: number) => ({ min, mode, max });

export function defaultRoles(): StaffRole[] {
  const lunch = (id: string) => ({
    id: `${id}-lunch`,
    label: 'Lunch break',
    earliestMin: 200,
    latestMin: 290,
    durationMin: 30,
    destinationTypes: ['Staff Lounge'],
  });
  const shortBreak = (id: string, e: number, l: number) => ({
    id: `${id}-break-${e}`,
    label: 'Short break',
    earliestMin: e,
    latestMin: l,
    durationMin: 12,
    destinationTypes: ['Staff Lounge'],
  });
  const toilet = (id: string) => ({
    id: `${id}-toilet`,
    label: 'Restroom',
    destinationTypes: ['Staff Toilet'],
    weight: 0.25,
    dwell: tri(2, 3, 6),
    chainProbability: 0,
  });
  return [
    {
      id: 'role-rn',
      name: 'Registered Nurse',
      shortName: 'RN',
      color: ROLE_PALETTE[0],
      custom: false,
      homeBaseTypes: ['Nurse Station'],
      homeDwell: tri(1.5, 4, 10),
      walkingSpeedMps: 1.25,
      walkingSpeedSd: 0.08,
      locality: 1.2,
      shiftVariationMin: 6,
      activities: [
        { id: 'rn-assess', label: 'Patient assessment', destinationTypes: ['Exam Room'], weight: 5, dwell: tri(4, 8, 15), chainProbability: 0.25 },
        { id: 'rn-meds', label: 'Medication preparation', destinationTypes: ['Medication Room'], weight: 2, dwell: tri(2, 4, 8), chainProbability: 0.6 },
        { id: 'rn-supply', label: 'Retrieve supplies', destinationTypes: ['Clean Supply'], weight: 1.5, dwell: tri(1, 2, 4), chainProbability: 0.5 },
        { id: 'rn-proc', label: 'Procedure assist', destinationTypes: ['Procedure Room'], weight: 1, dwell: tri(10, 20, 35), chainProbability: 0.1 },
        { id: 'rn-treat', label: 'Treatment', destinationTypes: ['Treatment'], weight: 0.8, dwell: tri(5, 10, 20), chainProbability: 0.15 },
        { id: 'rn-soiled', label: 'Soiled utility', destinationTypes: ['Soiled Utility'], weight: 0.6, dwell: tri(1, 2, 3), chainProbability: 0.3 },
        toilet('rn'),
      ],
      breaks: [shortBreak('rn', 90, 130), lunch('rn'), shortBreak('rn', 360, 400)],
    },
    {
      id: 'role-ma',
      name: 'Medical Assistant',
      shortName: 'MA',
      color: ROLE_PALETTE[1],
      custom: false,
      homeBaseTypes: ['Medical Assistant Workstation'],
      homeDwell: tri(1, 3, 8),
      walkingSpeedMps: 1.3,
      walkingSpeedSd: 0.08,
      locality: 1.5,
      shiftVariationMin: 5,
      activities: [
        { id: 'ma-room', label: 'Rooming patient', destinationTypes: ['Exam Room'], weight: 6, dwell: tri(3, 6, 10), chainProbability: 0.2 },
        { id: 'ma-call', label: 'Call patient from waiting', destinationTypes: ['Waiting'], weight: 2.5, dwell: tri(0.5, 1, 2), chainProbability: 0.9 },
        { id: 'ma-supply', label: 'Restock supplies', destinationTypes: ['Clean Supply'], weight: 1.5, dwell: tri(1, 2, 4), chainProbability: 0.4 },
        { id: 'ma-lab', label: 'Specimen drop-off', destinationTypes: ['Laboratory'], weight: 1, dwell: tri(1, 3, 5), chainProbability: 0.2 },
        { id: 'ma-soiled', label: 'Room turnover', destinationTypes: ['Soiled Utility'], weight: 0.8, dwell: tri(1, 2, 3), chainProbability: 0.3 },
        toilet('ma'),
      ],
      breaks: [shortBreak('ma', 100, 140), lunch('ma'), shortBreak('ma', 370, 410)],
    },
    {
      id: 'role-md',
      name: 'Physician',
      shortName: 'MD',
      color: ROLE_PALETTE[2],
      custom: false,
      homeBaseTypes: ['Physician Workroom'],
      homeDwell: tri(3, 6, 14),
      walkingSpeedMps: 1.2,
      walkingSpeedSd: 0.08,
      locality: 0.6,
      shiftVariationMin: 10,
      activities: [
        { id: 'md-visit', label: 'Patient visit', destinationTypes: ['Exam Room'], weight: 6, dwell: tri(8, 14, 25), chainProbability: 0.35 },
        { id: 'md-proc', label: 'Procedure', destinationTypes: ['Procedure Room'], weight: 1.2, dwell: tri(15, 30, 45), chainProbability: 0.1 },
        { id: 'md-consult', label: 'Care team consult', destinationTypes: ['Nurse Station'], weight: 1, dwell: tri(2, 5, 10), chainProbability: 0.3 },
        toilet('md'),
      ],
      breaks: [lunch('md')],
    },
    {
      id: 'role-app',
      name: 'Advanced Practice Provider',
      shortName: 'APP',
      color: ROLE_PALETTE[3],
      custom: false,
      homeBaseTypes: ['Physician Workroom'],
      homeDwell: tri(4, 9, 20),
      walkingSpeedMps: 1.2,
      walkingSpeedSd: 0.08,
      locality: 0.8,
      shiftVariationMin: 10,
      activities: [
        { id: 'app-visit', label: 'Patient visit', destinationTypes: ['Exam Room'], weight: 6, dwell: tri(8, 15, 25), chainProbability: 0.3 },
        { id: 'app-consult', label: 'Care team consult', destinationTypes: ['Nurse Station'], weight: 1.2, dwell: tri(2, 5, 10), chainProbability: 0.3 },
        toilet('app'),
      ],
      breaks: [lunch('app')],
    },
    {
      id: 'role-tech',
      name: 'Technician',
      shortName: 'TECH',
      color: ROLE_PALETTE[4],
      custom: false,
      homeBaseTypes: ['Laboratory'],
      homeDwell: tri(5, 12, 25),
      walkingSpeedMps: 1.25,
      walkingSpeedSd: 0.08,
      locality: 0.8,
      shiftVariationMin: 8,
      activities: [
        { id: 'tech-proc', label: 'Procedure setup', destinationTypes: ['Procedure Room'], weight: 4, dwell: tri(10, 18, 30), chainProbability: 0.2 },
        { id: 'tech-equip', label: 'Equipment retrieval', destinationTypes: ['Equipment Storage'], weight: 2, dwell: tri(2, 4, 8), chainProbability: 0.7 },
        { id: 'tech-exam', label: 'Diagnostic test', destinationTypes: ['Exam Room'], weight: 2, dwell: tri(5, 10, 15), chainProbability: 0.15 },
        { id: 'tech-soiled', label: 'Instrument return', destinationTypes: ['Soiled Utility'], weight: 1.5, dwell: tri(2, 3, 5), chainProbability: 0.2 },
        toilet('tech'),
      ],
      breaks: [shortBreak('tech', 110, 150), lunch('tech')],
    },
    {
      id: 'role-admin',
      name: 'Reception / Administrative Staff',
      shortName: 'ADM',
      color: ROLE_PALETTE[5],
      custom: false,
      homeBaseTypes: ['Reception'],
      homeDwell: tri(10, 22, 45),
      walkingSpeedMps: 1.2,
      walkingSpeedSd: 0.06,
      locality: 1.5,
      shiftVariationMin: 4,
      activities: [
        { id: 'adm-wait', label: 'Waiting area assistance', destinationTypes: ['Waiting'], weight: 3, dwell: tri(1, 2, 4), chainProbability: 0.05 },
        { id: 'adm-ns', label: 'Deliver paperwork', destinationTypes: ['Nurse Station'], weight: 0.8, dwell: tri(1, 2, 4), chainProbability: 0.1 },
        { id: 'adm-md', label: 'Provider coordination', destinationTypes: ['Physician Workroom'], weight: 0.3, dwell: tri(1, 3, 5), chainProbability: 0.1 },
        toilet('adm'),
      ],
      breaks: [shortBreak('adm', 100, 140), lunch('adm'), shortBreak('adm', 360, 400)],
    },
    {
      id: 'role-evs',
      name: 'Environmental Services',
      shortName: 'EVS',
      color: ROLE_PALETTE[6],
      custom: false,
      homeBaseTypes: ['Soiled Utility'],
      homeDwell: tri(2, 5, 10),
      walkingSpeedMps: 1.15,
      walkingSpeedSd: 0.08,
      locality: 1.0,
      shiftVariationMin: 5,
      activities: [
        { id: 'evs-exam', label: 'Room cleaning', destinationTypes: ['Exam Room', 'Procedure Room'], weight: 4, dwell: tri(4, 7, 12), chainProbability: 0.5 },
        { id: 'evs-toilet', label: 'Restroom service', destinationTypes: ['Patient Toilet', 'Staff Toilet'], weight: 2, dwell: tri(4, 6, 10), chainProbability: 0.4 },
        { id: 'evs-wait', label: 'Public area cleaning', destinationTypes: ['Waiting'], weight: 1, dwell: tri(5, 10, 15), chainProbability: 0.3 },
      ],
      breaks: [lunch('evs')],
    },
    {
      id: 'role-other',
      name: 'Other',
      shortName: 'OTH',
      color: ROLE_PALETTE[7],
      custom: false,
      homeBaseTypes: ['Nurse Station'],
      homeDwell: tri(5, 10, 20),
      walkingSpeedMps: 1.2,
      walkingSpeedSd: 0.08,
      locality: 1,
      shiftVariationMin: 5,
      activities: [
        { id: 'oth-exam', label: 'Clinical support', destinationTypes: ['Exam Room'], weight: 3, dwell: tri(3, 6, 12), chainProbability: 0.2 },
        { id: 'oth-supply', label: 'Supplies', destinationTypes: ['Clean Supply'], weight: 1, dwell: tri(1, 2, 4), chainProbability: 0.3 },
      ],
      breaks: [lunch('oth')],
    },
  ];
}

export function defaultSimulationConfig(): SimulationConfig {
  return {
    seed: 20251,
    studyStartMin: 8 * 60,
    studyEndMin: 16 * 60,
    studyDate: '2025-03-12',
    sampleIntervalS: 1,
    positionJitterM: 0.5,
    peakPeriods: [
      { id: 'peak-am', label: 'Morning clinic peak', startMin: 9 * 60, endMin: 11 * 60, intensity: 1.35 },
      { id: 'peak-pm', label: 'Afternoon clinic peak', startMin: 13 * 60 + 30, endMin: 15 * 60, intensity: 1.2 },
    ],
  };
}

export function defaultPrefs(): VisualizationPrefs {
  return { units: 'ft', showGrid: false, showScaleBar: true, minGroupSize: 1 };
}
