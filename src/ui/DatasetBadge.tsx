import { FlaskConical, Radio } from 'lucide-react';
import { useActiveDataset, useData } from '@/store/dataStore';
import { cx } from './components/controls';

/** Persistent dataset designation. Simulated data is always labelled. */
export function DatasetBadge({ compact, className }: { compact?: boolean; className?: string }) {
  const ds = useActiveDataset();
  const status = useData((s) => s.simStatus);
  if (!ds) {
    return (
      <span className={cx('rounded-[2px] bg-line-2 px-2 py-1 text-[10.5px] font-semibold tracking-[0.06em] text-muted uppercase', className)}>
        {status === 'running' ? 'Simulating…' : 'No movement data'}
      </span>
    );
  }
  if (ds.meta.kind === 'simulated') {
    return (
      <span className={cx('inline-flex items-center gap-1.5 rounded-[2px] bg-sim-bg px-2 py-1 text-[10.5px] font-semibold tracking-[0.06em] text-sim uppercase', className)} title={ds.meta.source}>
        <FlaskConical size={12} />
        {compact ? 'Simulated data — demo only' : 'Simulated data — demonstration only'}
      </span>
    );
  }
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5 rounded-[2px] px-2 py-1 text-[10.5px] font-semibold tracking-[0.06em] uppercase', ds.meta.synthetic ? 'bg-sim-bg text-sim' : 'bg-obs-bg text-obs', className)} title={ds.meta.source}>
      <Radio size={12} />
      <span className={cx('truncate', compact && 'max-w-[220px]')}>
        {ds.meta.synthetic ? (compact ? 'Synthetic test data' : 'Imported synthetic test data') : 'Observed data'} · {ds.meta.name}
      </span>
    </span>
  );
}
