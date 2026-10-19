import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { clock } from '@/store/playback';
import { useActiveDataset } from '@/store/dataStore';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { useAnalysis, getLocator } from '@/store/analysis';
import { distanceUntil } from '@/analytics/engine';
import { positionAt } from '@/analytics/trackUtils';
import { currentSpan } from '@/ui/plan/MovementLayer';
import { Badge, Stat } from '@/ui/components/controls';
import { fmtClock, fmtDistance, fmtDuration, fmtPct } from '@/ui/format';
import { QualityTag } from './QualityTag';

/** Playback time sampled at a modest rate for React panels. */
export function useClockThrottled(ms = 250): number {
  const [t, setT] = useState(clock.t);
  useEffect(() => {
    let last = 0;
    let pending = 0;
    const unsub = clock.subscribe((v) => {
      const now = performance.now();
      if (now - last > ms) {
        last = now;
        setT(v);
      } else {
        clearTimeout(pending);
        pending = window.setTimeout(() => setT(clock.t), ms);
      }
    });
    return () => {
      unsub();
      clearTimeout(pending);
    };
  }, [ms]);
  return t;
}

export function StaffInspector({ staffId }: { staffId: string }) {
  const ds = useActiveDataset();
  const p = useProject((s) => s.project!);
  const select = useUI((s) => s.select);
  const analysis = useAnalysis({ ignoreFilters: true });
  const t = useClockThrottled();
  const unit = p.prefs.units;
  const track = ds?.tracks.find((x) => x.staffId === staffId);
  const def = p.staff.find((s) => s.id === staffId);
  const role = p.roles.find((r) => r.id === track?.roleId);
  const spans = useMemo(() => (ds?.spans ?? []).filter((s) => s.staffId === staffId), [ds, staffId]);
  const a = analysis?.staff.find((s) => s.staffId === staffId);
  if (!ds || !track) return null;
  const sim = ds.meta.kind === 'simulated';
  const loc = getLocator(p.spatial);
  const pos = positionAt(track, t);
  const si = pos ? loc.locate(pos.p.x, pos.p.y) : -1;
  const roomName = si >= 0 ? loc.spaces[si].name : pos ? 'Outside defined spaces' : 'Not tracked at this time';
  const span = sim ? currentSpan(spans, t) : null;
  const dest = span?.kind === 'walk' && span.roomId ? loc.spaces[loc.index.get(span.roomId) ?? -1]?.name : null;
  const toNow = distanceUntil(track, t);
  const visitsToNow = (a?.visits ?? []).filter((v) => v.start <= t);
  const tripsToNow = (a?.trips ?? []).filter((v) => v.start <= t);
  const kindTag = sim ? 'simulated' : 'calculated';

  return (
    <div>
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: role?.color ?? '#999' }} />
        <div className="min-w-0 flex-1">
          <div className="text-2xs font-medium tracking-[0.06em] text-muted uppercase">{role?.name ?? 'Unassigned role'}</div>
          <div className="text-[15px] font-semibold tnum">{def?.code ?? staffId}</div>
        </div>
        <button className="rounded p-1 text-muted hover:bg-black/5" onClick={() => select(null)} title="Clear selection">
          <X size={14} />
        </button>
      </div>

      <div className="mb-3 rounded-[3px] border border-line-2 bg-paper p-2.5">
        <div className="mb-1 flex items-center justify-between text-2xs text-muted">
          <span className="font-medium tracking-[0.06em] uppercase">At {fmtClock(t)}</span>
          {pos?.inGap && <Badge tone="warn">Tracking gap</Badge>}
        </div>
        <div className="text-[13px] font-medium">{roomName}</div>
        {sim && span && (
          <div className="mt-1 text-[12px] text-ink-2">
            {span.kind === 'walk' ? 'Walking' : 'Activity'}: {span.label}
            {dest && <> → <b>{dest}</b></>}
            <div className="mt-0.5 text-2xs text-sim">Activity and destination are simulation ground truth.</div>
          </div>
        )}
        {!sim && <div className="mt-1 text-2xs text-muted">Observed data: activity and destination are not recorded and are not inferred.</div>}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <Stat label="Distance to time" value={fmtDistance(toNow.distanceM, unit)} quality={<QualityTag kind={kindTag} />} sub={a ? `${fmtDistance(a.distanceM, unit)} in window` : undefined} />
        <Stat label="Time moving" value={fmtDuration(toNow.movingS)} sub={a ? `${fmtPct(a.movingS / Math.max(1, a.trackedS))} of tracked time` : undefined} />
        <Stat label="Time stationary" value={fmtDuration(toNow.stationaryS)} />
        <Stat label="Rooms visited" value={new Set(visitsToNow.map((v) => v.roomId)).size} sub={`${visitsToNow.length} visits · ${tripsToNow.length} trips`} />
      </div>
      {a && a.gapS > 0 && (
        <div className="mt-3 rounded-[3px] bg-[#fdf6e7] px-2 py-1.5 text-2xs text-[#7a5410]">
          {fmtDuration(a.gapS)} of tracking gaps in window. Movement across gaps is excluded from distance (straight-line across gaps ≈ {fmtDistance(a.gapBridgeM, unit)}, estimated lower bound).
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 text-2xs font-semibold tracking-[0.06em] text-muted uppercase">Travel history</div>
        <div className="max-h-[340px] overflow-auto rounded-[3px] border border-line-2 bg-paper">
          {visitsToNow.length === 0 && <div className="p-3 text-center text-2xs text-muted">No room visits yet at this time.</div>}
          {[...visitsToNow].reverse().map((v, i, arr) => {
            const trip = tripsToNow.find((tp) => tp.end === v.start && tp.toRoomId === v.roomId);
            const live = v.end > t;
            return (
              <div key={v.start} className="border-b border-line-2 px-2 py-1.5 last:border-0">
                <div className="flex items-baseline gap-2 text-[12px]">
                  <span className="w-[54px] shrink-0 tnum text-2xs text-muted">{fmtClock(v.start)}</span>
                  <span className="flex-1 truncate font-medium">{loc.spaces[v.spaceIndex]?.name}</span>
                  <span className="tnum text-2xs text-muted">{live ? 'now' : fmtDuration(v.end - v.start)}</span>
                </div>
                {trip && i < arr.length && (
                  <div className="pl-[62px] text-2xs text-faint tnum">
                    walked {fmtDistance(trip.distanceM, unit)} in {fmtDuration(trip.end - trip.start)}
                    {trip.hasGap && ' (gap)'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
