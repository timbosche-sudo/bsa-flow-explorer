import { cx } from '@/ui/components/controls';

export type DataBasis = 'measured' | 'calculated' | 'estimated' | 'simulated' | 'unavailable';

const LABEL: Record<DataBasis, string> = {
  measured: 'Measured',
  calculated: 'Calculated',
  estimated: 'Estimated',
  simulated: 'Simulated',
  unavailable: 'Unavailable',
};

const DESC: Record<DataBasis, string> = {
  measured: 'Directly recorded by the positioning system.',
  calculated: 'Derived by calculation from recorded positions.',
  estimated: 'Approximation (e.g. across tracking gaps); treat with caution.',
  simulated: 'Produced by the simulation engine from hypothetical assumptions — not measured evidence.',
  unavailable: 'Not available for this dataset.',
};

/** Small marker telling the reader how a value was obtained. */
export function QualityTag({ kind, className }: { kind: DataBasis; className?: string }) {
  return (
    <span
      title={DESC[kind]}
      className={cx(
        'inline-flex h-[14px] items-center rounded-[2px] px-1 text-[9px] font-semibold tracking-[0.05em] normal-case',
        kind === 'simulated' && 'bg-sim-bg text-sim',
        kind === 'calculated' && 'bg-obs-bg text-obs',
        kind === 'measured' && 'bg-[#e3f1e8] text-ok',
        kind === 'estimated' && 'bg-[#fbf0d9] text-warn',
        kind === 'unavailable' && 'bg-line-2 text-faint',
        className,
      )}
    >
      {LABEL[kind]}
    </span>
  );
}
