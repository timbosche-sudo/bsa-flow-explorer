import { X } from 'lucide-react';
import { useActiveDataset } from '@/store/dataStore';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { getLocator } from '@/store/analysis';
import { clock } from '@/store/playback';
import { Badge, Button } from '@/ui/components/controls';
import { fmtClock, fmtDistance } from '@/ui/format';

/** Details of a single recorded (or simulated) position sample. */
export function SampleInspector({ id }: { id: string }) {
  const ds = useActiveDataset();
  const p = useProject((s) => s.project!);
  const select = useUI((s) => s.select);
  const [staffId, idxStr] = id.split('#');
  const i = Number(idxStr);
  const tr = ds?.tracks.find((t) => t.staffId === staffId);
  if (!ds || !tr || !(i >= 0 && i < tr.t.length)) return null;
  const unit = p.prefs.units;
  const loc = getLocator(p.spatial);
  const si = loc.locate(tr.x[i], tr.y[i]);
  const prevDt = i > 0 ? tr.t[i] - tr.t[i - 1] : null;
  const speed = i > 0 && prevDt ? Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1]) / prevDt : null;
  const code = p.staff.find((s) => s.id === staffId)?.code ?? staffId;
  const rows: [string, React.ReactNode][] = [
    ['Tag / staff', code],
    ['Time', fmtClock(tr.t[i], true)],
    ['Position (x, y)', `${fmtDistance(tr.x[i], unit)}, ${fmtDistance(tr.y[i], unit)}`],
    ['Space', si >= 0 ? loc.spaces[si].name : 'Outside defined spaces'],
    ['Interval since previous', prevDt == null ? '—' : `${prevDt.toFixed(1)} s`],
    ['Speed from previous', speed == null ? '—' : `${speed.toFixed(2)} m/s`],
    ['Sample index', `${i + 1} of ${tr.t.length}`],
  ];
  return (
    <div>
      <div className="mb-3 flex items-start">
        <div className="flex-1">
          <div className="text-2xs font-medium tracking-[0.06em] text-muted uppercase">Data point</div>
          <div className="text-[14px] font-semibold">{code}</div>
        </div>
        <button className="rounded p-1 text-muted hover:bg-black/5" onClick={() => select(null)}>
          <X size={14} />
        </button>
      </div>
      <Badge tone={ds.meta.kind === 'simulated' ? 'sim' : 'obs'}>{ds.meta.kind === 'simulated' ? 'Simulated sample' : 'Observed sample'}</Badge>
      {tr.gap[i] === 1 && <Badge tone="warn" className="ml-1">After tracking gap</Badge>}
      <table className="mt-3 w-full text-[12px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-line-2">
              <td className="py-1.5 pr-2 text-muted">{k}</td>
              <td className="py-1.5 text-right tnum">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button size="sm" className="mt-3" onClick={() => clock.set(tr.t[i])}>
        Jump playback to this time
      </Button>
    </div>
  );
}
