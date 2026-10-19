/**
 * Full-width playback timeline: play/pause, restart, speed, loop, scrubbing,
 * selectable analysis window (time-of-day filter) and an activity sparkline.
 * The playhead and clock readout update imperatively from the playback clock.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Pause, Play, Repeat, RotateCcw } from 'lucide-react';
import { clock, effectiveSpeed, SPEEDS, usePlayback, type Speed } from '@/store/playback';
import { useActiveDataset } from '@/store/dataStore';
import { useProject } from '@/store/projectStore';
import { IconButton, cx } from './components/controls';
import { fmtClock } from './format';

const BIN_S = 120;

export function Timeline() {
  const pb = usePlayback();
  const ds = useActiveDataset();
  const peaks = useProject((s) => s.project!.simulation.peakPeriods);
  const track = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const timeText = useRef<HTMLSpanElement>(null);
  const span = pb.studyEnd - pb.studyStart;
  const pct = (t: number) => ((t - pb.studyStart) / span) * 100;

  // Movement activity sparkline (share of tracked staff moving per bin).
  const spark = useMemo(() => {
    if (!ds) return null;
    const n = Math.ceil(span / BIN_S);
    const moving = new Float32Array(n);
    for (const tr of ds.tracks) {
      for (let i = 1; i < tr.t.length; i++) {
        const dt = tr.t[i] - tr.t[i - 1];
        if (dt <= 0 || dt > 30 || tr.gap[i]) continue;
        const d = Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1]);
        if (d / dt < 0.3) continue;
        const b = Math.floor((tr.t[i - 1] - pb.studyStart) / BIN_S);
        if (b >= 0 && b < n) moving[b] += dt;
      }
    }
    const max = Math.max(1, ...moving);
    return Array.from(moving, (v) => v / max);
  }, [ds, pb.studyStart, span]);

  useEffect(() => {
    const update = (t: number) => {
      if (head.current) head.current.style.left = `${Math.max(0, Math.min(100, ((t - pb.studyStart) / span) * 100))}%`;
      if (timeText.current) timeText.current.textContent = fmtClock(t, true);
    };
    update(clock.t);
    return clock.subscribe(update);
  }, [pb.studyStart, span]);

  const timeFromEvent = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return pb.studyStart + f * span;
  };

  const dragKind = useRef<'scrub' | 'start' | 'end' | 'window' | null>(null);
  const dragOrigin = useRef({ t: 0, a: 0, b: 0 });
  const onDown = (e: React.PointerEvent, kind: 'scrub' | 'start' | 'end' | 'window') => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragKind.current = kind;
    const t = timeFromEvent(e.clientX);
    dragOrigin.current = { t, a: pb.rangeStart, b: pb.rangeEnd };
    if (kind === 'scrub') clock.set(Math.max(pb.rangeStart, Math.min(pb.rangeEnd, t)));
  };
  const onMove = (e: React.PointerEvent) => {
    const k = dragKind.current;
    if (!k) return;
    const t = timeFromEvent(e.clientX);
    const st = usePlayback.getState();
    if (k === 'scrub') clock.set(Math.max(st.rangeStart, Math.min(st.rangeEnd, t)));
    else if (k === 'start') st.setRange(snap(t), st.rangeEnd);
    else if (k === 'end') st.setRange(st.rangeStart, snap(t));
    else {
      const d = t - dragOrigin.current.t;
      const w = dragOrigin.current.b - dragOrigin.current.a;
      const a = Math.max(st.studyStart, Math.min(st.studyEnd - w, snap(dragOrigin.current.a + d)));
      st.setRange(a, a + w);
    }
  };
  const onUp = () => (dragKind.current = null);

  const hours: number[] = [];
  for (let h = Math.ceil(pb.studyStart / 3600); h * 3600 <= pb.studyEnd; h++) hours.push(h * 3600);
  const full = pb.rangeStart === pb.studyStart && pb.rangeEnd === pb.studyEnd;
  const presets: { label: string; a: number; b: number }[] = [
    { label: 'Full study', a: pb.studyStart, b: pb.studyEnd },
    { label: 'Morning', a: pb.studyStart, b: Math.min(pb.studyEnd, 12 * 3600) },
    { label: 'Afternoon', a: Math.max(pb.studyStart, 12 * 3600), b: pb.studyEnd },
    ...peaks.map((p) => ({ label: p.label, a: p.startMin * 60, b: p.endMin * 60 })),
  ].filter((p) => p.b - p.a >= 60 && p.a >= pb.studyStart && p.b <= pb.studyEnd);

  return (
    <div className="shrink-0 border-t border-line bg-paper px-3 pt-2 pb-2.5 select-none">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5">
          <IconButton title={pb.playing ? 'Pause (Space)' : 'Play (Space)'} active={pb.playing} onClick={() => pb.setPlaying(!pb.playing)} disabled={!ds}>
            {pb.playing ? <Pause size={15} /> : <Play size={15} />}
          </IconButton>
          <IconButton title="Restart" onClick={() => clock.set(pb.rangeStart)} disabled={!ds}>
            <RotateCcw size={14} />
          </IconButton>
          <IconButton title="Loop playback" active={pb.loop} onClick={() => pb.setLoop(!pb.loop)}>
            <Repeat size={14} />
          </IconButton>
        </div>
        <div className="w-[104px]">
          <span ref={timeText} className="tnum text-[15px] font-semibold tracking-tight" />
        </div>
        <div className="flex items-center rounded-[3px] border border-line p-[2px]" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={String(s)}
              onClick={() => pb.setSpeed(s as Speed)}
              className={cx('h-5 rounded-[2px] px-1.5 text-[11px] font-medium tnum', pb.speed === s ? 'bg-ink text-white' : 'text-ink-2 hover:bg-black/5')}
              title={s === 'auto' ? `Adaptive: plays the selected window in about 90 seconds (${Math.round(effectiveSpeed('auto', pb.rangeEnd - pb.rangeStart))}×)` : `${s}× real time`}
            >
              {s === 'auto' ? `Auto ${Math.round(effectiveSpeed('auto', pb.rangeEnd - pb.rangeStart))}×` : `${s}×`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 text-[11px]">
          <span className="text-muted">Window</span>
          <span className="tnum font-medium">
            {fmtClock(pb.rangeStart)} – {fmtClock(pb.rangeEnd)}
          </span>
          <select
            className="ml-1 h-6 rounded-[3px] border border-line bg-paper px-1 text-[11px]"
            value=""
            onChange={(e) => {
              const p = presets[Number(e.target.value)];
              if (p) pb.setRange(p.a, p.b);
            }}
          >
            <option value="">{full ? 'Full study' : 'Preset…'}</option>
            {presets.map((p, i) => (
              <option key={i} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="relative mt-1.5 h-[52px]" onPointerMove={onMove} onPointerUp={onUp}>
        <div ref={track} className="absolute inset-x-0 top-[14px] h-[26px] cursor-pointer rounded-[2px] bg-panel ring-1 ring-line" onPointerDown={(e) => onDown(e, 'scrub')}>
          {/* peak periods */}
          {peaks.map((p) => (
            <div key={p.id} className="absolute inset-y-0 bg-accent-soft" style={{ left: `${pct(p.startMin * 60)}%`, width: `${pct(p.endMin * 60) - pct(p.startMin * 60)}%` }} title={p.label} />
          ))}
          {spark && (
            <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox={`0 0 ${spark.length} 1`}>
              <path d={`M0 1 ${spark.map((v, i) => `L${i} ${1 - v * 0.9} L${i + 1} ${1 - v * 0.9}`).join(' ')} L${spark.length} 1 Z`} fill="#1d2327" opacity={0.13} />
            </svg>
          )}
          {/* outside-window shading */}
          <div className="absolute inset-y-0 left-0 bg-[#1d2327]/[0.07]" style={{ width: `${pct(pb.rangeStart)}%` }} />
          <div className="absolute inset-y-0 right-0 bg-[#1d2327]/[0.07]" style={{ width: `${100 - pct(pb.rangeEnd)}%` }} />
        </div>
        {/* window bar */}
        <div
          className="absolute top-[2px] h-[9px] cursor-grab rounded-[2px] bg-ink/75 hover:bg-ink"
          style={{ left: `${pct(pb.rangeStart)}%`, width: `${pct(pb.rangeEnd) - pct(pb.rangeStart)}%` }}
          onPointerDown={(e) => onDown(e, 'window')}
          title="Drag to move the analysis window"
        />
        {(['start', 'end'] as const).map((k) => (
          <div
            key={k}
            className="absolute top-0 h-[40px] w-[10px] -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${pct(k === 'start' ? pb.rangeStart : pb.rangeEnd)}%` }}
            onPointerDown={(e) => onDown(e, k)}
            title={k === 'start' ? 'Window start' : 'Window end'}
          >
            <div className="mx-auto h-full w-[2px] bg-ink/70" />
          </div>
        ))}
        <div ref={head} className="pointer-events-none absolute top-[10px] h-[34px] w-0">
          <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-accent" />
          <div className="absolute -left-px top-0 h-full w-[2px] bg-accent" />
        </div>
        {hours.map((h, i) => (
          <div
            key={h}
            className={cx('pointer-events-none absolute top-[40px] text-[9.5px] text-faint tnum', i === 0 && pct(h) < 1 ? '' : i === hours.length - 1 && pct(h) > 99 ? '-translate-x-full' : '-translate-x-1/2')}
            style={{ left: `${pct(h)}%` }}
          >
            {fmtClock(h).replace(':00', '')}
          </div>
        ))}
      </div>
    </div>
  );
}

const snap = (t: number) => Math.round(t / 300) * 300;
