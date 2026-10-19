import { describe, expect, it } from 'vitest';
import { leastSquaresEngine, multilaterate } from './positioning';
import type { Anchor } from '@/domain/types';

const anchor = (id: string, x: number, y: number): Anchor => ({ id, label: id, position: { x, y }, mountingHeightM: null, mountingNotes: '', power: 'battery', status: 'surveyed', surveyedPosition: null, surveyedZ: null });

describe('positioning engine', () => {
  const A = [anchor('A1', 0, 0), anchor('A2', 10, 0), anchor('A3', 0, 8), anchor('A4', 10, 8)];
  it('recovers a position from exact ranges', () => {
    const p = { x: 3.2, y: 5.1 };
    const res = multilaterate(A.map((a) => a.position), A.map((a) => Math.hypot(a.position.x - p.x, a.position.y - p.y)))!;
    expect(res.p.x).toBeCloseTo(3.2, 4);
    expect(res.p.y).toBeCloseTo(5.1, 4);
    expect(res.residual).toBeLessThan(1e-6);
  });
  it('rejects collinear / insufficient anchor geometry', () => {
    expect(multilaterate([{ x: 0, y: 0 }, { x: 5, y: 0 }], [1, 1])).toBeNull();
    expect(multilaterate([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }], [3, 3, 8])).toBeNull();
  });
  it('solves epochs of raw range observations', () => {
    const p = { x: 6, y: 2 };
    const ts = '2025-03-12T13:00:00.000Z';
    const ranges = A.map((a) => ({ studyId: 's', tagId: 'T1', anchorId: a.id, timestampUtc: ts, rangeM: Math.hypot(a.position.x - p.x, a.position.y - p.y) + 0.05 }));
    const est = leastSquaresEngine.solve(ranges, A);
    expect(est).toHaveLength(1);
    expect(est[0].x).toBeCloseTo(6, 0);
    expect(est[0].anchorsUsed).toBe(4);
  });
});
