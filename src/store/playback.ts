/**
 * Playback clock.
 *
 * The current playback time changes every animation frame, so it is NOT
 * stored in React state. Canvas layers subscribe directly to `clock` and
 * redraw imperatively; React UI only holds coarse playback settings.
 */
import { create } from 'zustand';

type Listener = (t: number) => void;

class Clock {
  t = 8 * 3600;
  private listeners = new Set<Listener>();
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  set(t: number) {
    this.t = t;
    for (const fn of this.listeners) fn(t);
  }
}

export const clock = new Clock();

export const SPEEDS = [1, 5, 20, 60, 'auto'] as const;
export type Speed = (typeof SPEEDS)[number];
/** Adaptive speed plays the whole selected range in this many real seconds. */
export const AUTO_REVIEW_SECONDS = 90;

interface PlaybackState {
  playing: boolean;
  speed: Speed;
  loop: boolean;
  /** Study bounds (seconds since midnight). */
  studyStart: number;
  studyEnd: number;
  /** Selected analysis/playback window. */
  rangeStart: number;
  rangeEnd: number;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: Speed) => void;
  setLoop: (l: boolean) => void;
  setStudy: (start: number, end: number) => void;
  setRange: (start: number, end: number) => void;
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  playing: false,
  speed: 'auto',
  loop: true,
  studyStart: 8 * 3600,
  studyEnd: 16 * 3600,
  rangeStart: 8 * 3600,
  rangeEnd: 16 * 3600,
  setPlaying: (playing) => {
    if (playing && clock.t >= get().rangeEnd - 0.5) clock.set(get().rangeStart);
    set({ playing });
  },
  setSpeed: (speed) => set({ speed }),
  setLoop: (loop) => set({ loop }),
  setStudy: (studyStart, studyEnd) => {
    set({ studyStart, studyEnd, rangeStart: studyStart, rangeEnd: studyEnd });
    if (clock.t < studyStart || clock.t > studyEnd) clock.set(studyStart);
  },
  setRange: (rangeStart, rangeEnd) => {
    const { studyStart, studyEnd } = get();
    const a = Math.max(studyStart, Math.min(rangeStart, rangeEnd - 60));
    const b = Math.min(studyEnd, Math.max(rangeEnd, a + 60));
    set({ rangeStart: a, rangeEnd: b });
    if (clock.t < a) clock.set(a);
    if (clock.t > b) clock.set(b);
  },
}));

export function effectiveSpeed(speed: Speed, rangeS: number): number {
  return speed === 'auto' ? Math.max(1, rangeS / AUTO_REVIEW_SECONDS) : speed;
}

let raf = 0;
let last = 0;
function tick(now: number) {
  const st = usePlayback.getState();
  if (!st.playing) {
    raf = 0;
    return;
  }
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  let t = clock.t + dtReal * effectiveSpeed(st.speed, st.rangeEnd - st.rangeStart);
  if (t >= st.rangeEnd) {
    if (st.loop) t = st.rangeStart;
    else {
      t = st.rangeEnd;
      usePlayback.setState({ playing: false });
    }
  }
  clock.set(t);
  raf = requestAnimationFrame(tick);
}

usePlayback.subscribe((s, prev) => {
  if (s.playing && !prev.playing && !raf) {
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
});
