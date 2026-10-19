/** Restrained chart primitives (Recharts) with consistent anatomy. */
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart, Legend, ReferenceLine } from 'recharts';
import type { ReactNode } from 'react';

const AXIS = { stroke: '#c3c2b7', tick: { fill: '#898781', fontSize: 10 }, tickLine: false } as const;
const GRID = { stroke: '#ebe9e3', strokeDasharray: '0', vertical: false } as const;

function Tip({ active, payload, label, fmt, labelFmt }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string | number; fmt: (v: number) => string; labelFmt?: (l: string | number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[11px] shadow-md">
      {label !== undefined && <div className="mb-0.5 font-semibold text-ink">{labelFmt ? labelFmt(label) : label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="flex-1">{p.name}</span>
          <span className="font-medium text-ink tnum">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartFrame({ title, sub, children, height = 160, note }: { title: string; sub?: ReactNode; children: ReactNode; height?: number; note?: ReactNode }) {
  return (
    <figure className="mt-4 mb-4">
      <figcaption className="mb-1">
        <div className="text-[11.5px] font-semibold text-ink">{title}</div>
        {sub && <div className="text-[10.5px] text-muted">{sub}</div>}
      </figcaption>
      <div style={{ height }}>{children}</div>
      {note && <div className="mt-1 text-[10px] leading-snug text-muted">{note}</div>}
    </figure>
  );
}

export function HBars({ data, fmt, height }: { data: { name: string; value: number; color: string }[]; fmt: (v: number) => string; height?: number }) {
  const h = height ?? Math.max(60, data.length * 26 + 16);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={84} {...AXIS} axisLine={false} tick={{ fill: '#52514e', fontSize: 11 }} />
        <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={<Tip fmt={fmt} />} />
        <Bar dataKey="value" name="Value" radius={[0, 4, 4, 0]} isAnimationActive={false} label={{ position: 'right', formatter: (v: number) => fmt(v), fill: '#52514e', fontSize: 10.5 }}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
}

export function Lines({ data, series, xKey, fmt, xFmt, refX }: { data: Record<string, number>[]; series: SeriesDef[]; xKey: string; fmt: (v: number) => string; xFmt: (v: number) => string; refX?: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} {...AXIS} tickFormatter={xFmt} minTickGap={18} />
        <YAxis {...AXIS} axisLine={false} tickFormatter={(v) => fmt(v)} width={52} />
        <Tooltip content={<Tip fmt={fmt} labelFmt={(l) => xFmt(Number(l))} />} cursor={{ stroke: '#c3c2b7' }} />
        {series.length > 1 && <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10.5, color: '#52514e' }} />}
        {refX !== undefined && <ReferenceLine x={refX} stroke="#a85d23" strokeWidth={1.5} />}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StackedBars({ data, series, xKey, fmt, xFmt }: { data: Record<string, number>[]; series: SeriesDef[]; xKey: string; fmt: (v: number) => string; xFmt: (v: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }} barCategoryGap={2}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} {...AXIS} tickFormatter={xFmt} />
        <YAxis {...AXIS} axisLine={false} tickFormatter={(v) => fmt(v)} width={52} />
        <Tooltip content={<Tip fmt={fmt} labelFmt={(l) => xFmt(Number(l))} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
        {series.length > 1 && <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10.5, color: '#52514e' }} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} stroke="#fcfcfb" strokeWidth={1} radius={i === series.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AreaSeries({ data, xKey, yKey, color, fmt, xFmt, threshold, name }: { data: Record<string, number>[]; xKey: string; yKey: string; color: string; fmt: (v: number) => string; xFmt: (v: number) => string; threshold?: number; name: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} {...AXIS} tickFormatter={xFmt} minTickGap={18} />
        <YAxis {...AXIS} axisLine={false} tickFormatter={(v) => fmt(v)} width={52} allowDecimals={false} />
        <Tooltip content={<Tip fmt={fmt} labelFmt={(l) => xFmt(Number(l))} />} cursor={{ stroke: '#c3c2b7' }} />
        {threshold !== undefined && <ReferenceLine y={threshold} stroke="#d03b3b" strokeDasharray="4 3" label={{ value: `threshold ${threshold}`, fill: '#898781', fontSize: 9.5, position: 'insideTopRight' }} />}
        <Area type="stepAfter" dataKey={yKey} name={name} stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.18} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
