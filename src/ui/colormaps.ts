/** Sequential (single-hue) and diverging ramps for heatmaps and choropleths. */
export type RampName = 'warm' | 'blue' | 'mono';

const RAMPS: Record<RampName, string[]> = {
  // Single-hue copper ramp, light -> dark.
  warm: ['#fbe7d6', '#f6c9a3', '#efa66d', '#e2813f', '#c9601f', '#a14512', '#76300b'],
  // Reference sequential blue.
  blue: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  mono: ['#e4e2de', '#c4c1bb', '#9f9b94', '#77736d', '#55524d', '#3a3835', '#1d1c1a'],
};

const DIVERGING = ['#184f95', '#3987e5', '#9ec5f4', '#f0efec', '#f3a8a7', '#e34948', '#9d2827'];

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function sample(stops: string[], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const rampRGB = (name: RampName, t: number) => sample(RAMPS[name], t);
export const divergingRGB = (t: number) => sample(DIVERGING, (t + 1) / 2);
export const rgbStr = ([r, g, b]: number[]) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
export const rampCss = (name: RampName) => `linear-gradient(90deg, ${RAMPS[name].join(',')})`;
export const divergingCss = () => `linear-gradient(90deg, ${DIVERGING.join(',')})`;
