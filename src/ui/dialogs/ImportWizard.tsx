/**
 * Observed tracking data import wizard (CSV / JSON).
 * Steps: files → columns → time & units → coordinate frame → tags & roles →
 * validation → import. Nothing is uploaded anywhere; parsing is local.
 */
import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { CircleAlert, FileUp } from 'lucide-react';
import { useUI } from '@/store/uiStore';
import { useProject } from '@/store/projectStore';
import { useData } from '@/store/dataStore';
import { usePlayback } from '@/store/playback';
import { Badge, Button, Field, Modal, NumberInput, Segmented, Select, TextInput, Toggle, cx } from '@/ui/components/controls';
import {
  cleanRecords,
  DEFAULT_THRESHOLDS,
  frameToWorld,
  guessMapping,
  parseRows,
  rowsFromJson,
  type CleanResult,
  type CleaningThresholds,
  type ColumnMapping,
  type CoordUnit,
  type ParseResult,
  type TimestampFormat,
} from '@/importer/pipeline';
import { getLocator } from '@/store/analysis';
import { uid } from '@/domain/defaults';
import { putDataset } from '@/services/persistence';
import { saveNow } from '@/services/projectLifecycle';
import type { CoordinateFrame, ObservedDataset } from '@/domain/types';
import { bbox, unionBBox } from '@/geometry/polygon';
import { fmtClock, fmtInt } from '@/ui/format';

const STEPS = ['Files', 'Columns', 'Time & units', 'Coordinates', 'Tags & roles', 'Validate'] as const;

interface LoadedFile {
  name: string;
  rows: Record<string, unknown>[];
  headers: string[];
}

export function ImportWizard() {
  const close = () => useUI.getState().setDialog('importOpen', false);
  const project = useProject((s) => s.project!);
  const notify = useUI((s) => s.notify);
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ tag: null, timestamp: null, x: null, y: null, z: null, quality: null, uncertainty: null, source: null });
  const [tsFormat, setTsFormat] = useState<TimestampFormat>('auto');
  const [unit, setUnit] = useState<CoordUnit>('m');
  const [studyDate, setStudyDate] = useState(project.simulation.studyDate);
  const [utcOffsetH, setUtcOffsetH] = useState(-new Date(`${project.simulation.studyDate}T12:00:00`).getTimezoneOffset() / 60);
  const [frame, setFrame] = useState<CoordinateFrame>(project.coordinateFrames[0] ?? { id: 'frame-world', name: 'Building world frame', unit: 'm', offset: { x: 0, y: 0 }, rotationDeg: 0, flipY: false });
  const [tagRoles, setTagRoles] = useState<Record<string, string | null>>({});
  const [th, setTh] = useState<CleaningThresholds>(DEFAULT_THRESHOLDS);
  const [name, setName] = useState('');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [synthetic, setSynthetic] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const headers = files[0]?.headers ?? [];
  const allRows = useMemo(() => files.flatMap((f) => f.rows), [files]);

  const parsed: ParseResult | null = useMemo(() => {
    if (!allRows.length || !mapping.tag || !mapping.timestamp || !mapping.x || !mapping.y) return null;
    return parseRows(allRows, { mapping, timestampFormat: tsFormat, unit, utcOffsetMin: utcOffsetH * 60, studyDate });
  }, [allRows, mapping, tsFormat, unit, utcOffsetH, studyDate]);

  const world = useMemo(() => parsed?.records.map((r) => ({ ...r, ...frameToWorld(frame, r.x, r.y) })) ?? [], [parsed, frame]);
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of world) m.set(r.tag, (m.get(r.tag) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [world]);

  const cleaned: CleanResult | null = useMemo(() => {
    if (step < 5 || !parsed) return null;
    const loc = getLocator(project.spatial);
    const hasSpaces = loc.spaces.length > 0;
    const margin = Math.max(0, th.outsideMarginM);
    const inside = (x: number, y: number) =>
      !hasSpaces || loc.locate(x, y) >= 0 || (margin > 0 && [[margin, 0], [-margin, 0], [0, margin], [0, -margin]].some(([dx, dy]) => loc.locate(x + dx, y + dy) >= 0));
    const roles: Record<string, string | null> = {};
    for (const [t] of tags) roles[t] = tagRoles[t] ?? defaultRole(t);
    return cleanRecords(world, parsed, th, inside, roles);
  }, [step, parsed, world, th, tags, tagRoles, project.spatial]); // eslint-disable-line react-hooks/exhaustive-deps

  function defaultRole(tag: string): string | null {
    const s = project.staff.find((m) => m.tagId === tag || m.code === tag);
    return s?.roleId ?? null;
  }

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const out: LoadedFile[] = [];
    try {
      for (const f of Array.from(list)) {
        const text = await f.text();
        let rows: Record<string, unknown>[];
        if (f.name.toLowerCase().endsWith('.json')) rows = rowsFromJson(text);
        else {
          const res = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true, dynamicTyping: false });
          if (res.errors.length && !res.data.length) throw new Error(`${f.name}: ${res.errors[0].message}`);
          rows = res.data;
        }
        const hs = Object.keys(rows[0] ?? {});
        if (!hs.length) throw new Error(`${f.name} contains no records.`);
        out.push({ name: f.name, rows, headers: hs });
      }
      const h0 = out[0].headers.join('|');
      if (out.some((f) => f.headers.join('|') !== h0)) setError('Files have different columns; they will be mapped using the first file’s columns.');
      setFiles(out);
      setMapping(guessMapping(out[0].headers));
      setName(out.map((f) => f.name.replace(/\.(csv|json|txt)$/i, '')).join(' + ').slice(0, 60));
      setSynthetic(out.some((f) => /synthetic|test/i.test(f.name)));
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const detectDate = () => {
    if (!parsed?.firstEpochMs) return;
    const local = new Date(parsed.firstEpochMs + utcOffsetH * 3600000);
    setStudyDate(local.toISOString().slice(0, 10));
  };

  const doImport = async () => {
    if (!cleaned || !parsed) return;
    const now = new Date().toISOString();
    const id = uid('obs');
    const frames = project.coordinateFrames.some((f) => f.id === frame.id) ? project.coordinateFrames.map((f) => (f.id === frame.id ? frame : f)) : [...project.coordinateFrames, frame];
    const ds: ObservedDataset = {
      meta: {
        id,
        name: name || 'Imported dataset',
        kind: 'observed',
        createdAt: now,
        studyDate,
        source: files.map((f) => f.name).join(', '),
        coordinateFrameId: frame.id,
        positionAccuracyM: accuracy,
        synthetic,
        utcOffsetMin: utcOffsetH * 60,
        provenance: [
          { date: now, action: 'import', detail: `${fmtInt(parsed.totalRows)} rows from ${files.length} file(s); columns ${JSON.stringify(mapping)}; timestamps ${tsFormat}, UTC${utcOffsetH >= 0 ? '+' : ''}${utcOffsetH}; units ${unit}` },
          { date: now, action: 'coordinate-transform', detail: `Frame "${frame.name}": offset (${frame.offset.x}, ${frame.offset.y}) m, rotation ${frame.rotationDeg}°, flipY ${frame.flipY}` },
          { date: now, action: 'clean', detail: cleaned.report.issues.filter((i) => i.count > 0).map((i) => `${i.code}: ${i.count} (${i.action})`).join('; ') || 'No issues found' },
        ],
      },
      rawTracks: cleaned.rawTracks,
      cleanTracks: cleaned.cleanTracks.filter((t) => t.t.length > 0),
      tagRoles: Object.fromEntries(cleaned.cleanTracks.map((t) => [t.staffId, t.roleId])),
      qualityReport: cleaned.report,
    };
    try {
      await putDataset(ds);
    } catch (e) {
      notify(`Could not store dataset: ${e instanceof Error ? e.message : e}`, 'error');
      return;
    }
    useData.getState().addObserved(ds);
    useProject.getState().setObservedDatasetIds([...project.observedDatasetIds, id]);
    useProject.getState().setCoordinateFrames(frames);
    activateObserved(ds);
    await saveNow();
    notify(`Imported ${fmtInt(cleaned.report.importedRecords)} observations for ${ds.cleanTracks.length} tags.`);
    close();
  };

  const canNext =
    (step === 0 && files.length > 0) ||
    (step === 1 && !!(mapping.tag && mapping.timestamp && mapping.x && mapping.y)) ||
    (step === 2 && !!parsed && parsed.records.length > 0) ||
    step === 3 ||
    step === 4;

  return (
    <Modal
      title="Import tracking data"
      width={760}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {step < 5 ? (
            <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <Button variant="primary" disabled={!cleaned || cleaned.report.importedRecords === 0} onClick={doImport}>
              Import observations
            </Button>
          )}
        </>
      }
    >
      <ol className="mb-4 flex gap-1">
        {STEPS.map((s, i) => (
          <li key={s} className={cx('flex-1 border-t-2 pt-1 text-[11px]', i <= step ? 'border-accent text-ink' : 'border-line text-faint')}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {error && (
        <div className="mb-3 flex gap-1.5 rounded-[3px] bg-[#fdf3f3] p-2 text-[12px] text-err">
          <CircleAlert size={14} className="mt-[1px] shrink-0" />
          {error}
        </div>
      )}

      {step === 0 && (
        <div>
          <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-[4px] border border-dashed border-line bg-panel py-10 text-muted hover:border-accent">
            <FileUp size={22} />
            <span className="text-[13px] font-medium text-ink">Choose CSV or JSON files</span>
            <span className="text-[11.5px]">One or more files from the positioning system. Files are read locally and never uploaded.</span>
          </button>
          <input ref={fileRef} type="file" multiple accept=".csv,.json,.txt,text/csv,application/json" className="hidden" onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            Expected fields: study ID, anonymous tag ID, UTC timestamp, X and Y in a calibrated building frame (meters preferred), optional Z, quality and uncertainty. See <code>docs/DATA_FORMATS.md</code>.
            A synthetic test file is included at <code>public/sample/synthetic-tag-export-TEST.csv</code>.
          </p>
        </div>
      )}

      {step >= 1 && files.length > 0 && step <= 1 && (
        <div>
          <div className="mb-2 text-[12px] text-muted">
            {files.map((f) => `${f.name} (${fmtInt(f.rows.length)} rows)`).join(' · ')}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(['tag', 'timestamp', 'x', 'y', 'z', 'quality', 'uncertainty', 'source'] as const).map((k) => (
              <Field key={k} label={`${k}${['tag', 'timestamp', 'x', 'y'].includes(k) ? ' *' : ''}`}>
                <Select value={mapping[k] ?? ''} onChange={(v) => setMapping({ ...mapping, [k]: v || null })} options={[{ value: '', label: '— none —' }, ...headers.map((h) => ({ value: h, label: h }))]} />
              </Field>
            ))}
          </div>
          <Preview rows={files[0].rows.slice(0, 8)} headers={headers} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Timestamp format">
              <Select
                value={tsFormat}
                onChange={setTsFormat}
                options={[
                  { value: 'auto', label: 'Auto-detect' },
                  { value: 'iso', label: 'ISO 8601 (UTC)' },
                  { value: 'epoch-s', label: 'Unix seconds' },
                  { value: 'epoch-ms', label: 'Unix milliseconds' },
                  { value: 'time-of-day', label: 'Local time of day (HH:MM:SS)' },
                ]}
              />
            </Field>
            <Field label="Site offset from UTC (hours)" hint="Converts UTC timestamps to local study time.">
              <NumberInput value={utcOffsetH} step={0.5} min={-14} max={14} onCommit={(v) => setUtcOffsetH(v ?? 0)} />
            </Field>
            <Field label="Study date (local)">
              <div className="flex gap-1">
                <input type="date" className="h-7 flex-1 rounded-[3px] border border-line px-2 text-[12.5px]" value={studyDate} onChange={(e) => setStudyDate(e.target.value)} />
                <Button size="sm" onClick={detectDate} disabled={!parsed?.firstEpochMs}>
                  Detect
                </Button>
              </div>
            </Field>
          </div>
          <Field label="Coordinate units">
            <Segmented value={unit} onChange={setUnit} options={[{ value: 'm', label: 'meters' }, { value: 'ft', label: 'feet' }, { value: 'cm', label: 'cm' }, { value: 'mm', label: 'mm' }]} />
          </Field>
          {parsed && (
            <div className="rounded-[3px] border border-line-2 bg-panel p-2.5 text-[12px]">
              <div>
                Parsed <b>{fmtInt(parsed.records.length)}</b> of {fmtInt(parsed.totalRows)} rows · {tags.length} tags
              </div>
              {parsed.records.length > 0 && (
                <div className="text-muted">
                  Local time span {fmtClock(Math.min(...parsed.records.slice(0, 50000).map((r) => r.t)))} – {fmtClock(Math.max(...parsed.records.slice(-50000).map((r) => r.t)))} on {studyDate}
                </div>
              )}
              {(parsed.missingTimestamp > 0 || parsed.missingTag > 0 || parsed.invalidCoordinate > 0) && (
                <div className="mt-1 text-warn">
                  {parsed.missingTimestamp} missing/invalid timestamps · {parsed.missingTag} missing tag IDs · {parsed.invalidCoordinate} invalid coordinates (excluded and reported)
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="grid grid-cols-[1fr_320px] gap-4">
          <div className="space-y-2.5">
            <Field label="Coordinate reference frame">
              <Select
                value={project.coordinateFrames.some((f) => f.id === frame.id) ? frame.id : 'new'}
                onChange={(v) => (v === 'new' ? setFrame({ id: uid('frame'), name: 'Positioning system frame', unit: 'm', offset: { x: 0, y: 0 }, rotationDeg: 0, flipY: false }) : setFrame(project.coordinateFrames.find((f) => f.id === v)!))}
                options={[...project.coordinateFrames.map((f) => ({ value: f.id, label: f.name })), { value: 'new', label: '+ New frame…' }]}
              />
            </Field>
            <Field label="Frame name">
              <TextInput value={frame.name} onCommit={(n) => setFrame({ ...frame, name: n })} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Origin X (m)">
                <NumberInput value={frame.offset.x} step={0.1} onCommit={(v) => setFrame({ ...frame, offset: { ...frame.offset, x: v ?? 0 } })} />
              </Field>
              <Field label="Origin Y (m)">
                <NumberInput value={frame.offset.y} step={0.1} onCommit={(v) => setFrame({ ...frame, offset: { ...frame.offset, y: v ?? 0 } })} />
              </Field>
              <Field label="Rotation (°)">
                <NumberInput value={frame.rotationDeg} step={1} onCommit={(v) => setFrame({ ...frame, rotationDeg: v ?? 0 })} />
              </Field>
            </div>
            <Toggle label="Incoming Y axis points up (engineering convention)" checked={frame.flipY} onChange={(flipY) => setFrame({ ...frame, flipY })} />
            <p className="text-[11px] leading-relaxed text-muted">
              Origin is the position of the positioning system’s (0,0) in building world coordinates (meters, from the drawing origin; y down). Check the preview: recorded points should fall inside the mapped spaces.
            </p>
          </div>
          <FramePreview points={world} />
        </div>
      )}

      {step === 4 && (
        <div>
          <p className="mb-2 text-[12px] text-muted">Associate each anonymous tag with a staff role. Use role groups only — do not enter names.</p>
          <div className="max-h-[360px] overflow-auto rounded-[3px] border border-line-2">
            {tags.map(([t, n]) => (
              <div key={t} className="flex items-center gap-3 border-b border-line-2 px-3 py-1.5 last:border-0">
                <span className="w-40 font-medium tnum">{t}</span>
                <span className="w-24 text-[11.5px] text-muted tnum">{fmtInt(n)} records</span>
                <Select
                  className="flex-1"
                  value={tagRoles[t] ?? defaultRole(t) ?? ''}
                  onChange={(v) => setTagRoles({ ...tagRoles, [t]: v || null })}
                  options={[{ value: '', label: 'Unassigned role' }, ...project.roles.map((r) => ({ value: r.id, label: r.name }))]}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-2">
            <Field label="Max speed (m/s)">
              <NumberInput value={th.maxSpeedMps} min={0.5} step={0.5} onCommit={(v) => setTh({ ...th, maxSpeedMps: v ?? 3 })} />
            </Field>
            <Field label="Gap threshold (s)">
              <NumberInput value={th.maxGapS} min={2} step={5} onCommit={(v) => setTh({ ...th, maxGapS: v ?? 30 })} />
            </Field>
            <Field label="Max uncertainty (m)" hint="0 = off">
              <NumberInput value={th.maxUncertaintyM} min={0} step={0.1} onCommit={(v) => setTh({ ...th, maxUncertaintyM: v ?? 0 })} />
            </Field>
            <Field label="Outside area" hint="margin m; −1 keeps">
              <NumberInput value={th.outsideMarginM} min={-1} step={0.5} onCommit={(v) => setTh({ ...th, outsideMarginM: v ?? -1 })} />
            </Field>
            <Field label="Median window" hint="1 = off">
              <NumberInput value={th.medianWindow} min={1} max={15} step={2} onCommit={(v) => setTh({ ...th, medianWindow: Math.max(1, Math.round(v ?? 1)) | 1 })} />
            </Field>
          </div>
          {cleaned && (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-muted">
                  <th className="pb-1 font-medium">Check</th>
                  <th className="pb-1 text-right font-medium">Count</th>
                  <th className="pb-1 pl-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {cleaned.report.issues.map((i) => (
                  <tr key={i.code} className="border-t border-line-2">
                    <td className="py-1">{i.description}</td>
                    <td className={cx('py-1 text-right', i.count > 0 ? 'font-semibold text-warn' : 'text-faint')}>{fmtInt(i.count)}</td>
                    <td className="py-1 pl-3 text-muted">{i.action}</td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <td className="py-1 font-semibold">Clean observations to import</td>
                  <td className="py-1 text-right font-semibold">{fmtInt(cleaned.report.importedRecords)}</td>
                  <td className="py-1 pl-3 text-muted">Raw observations are preserved separately</td>
                </tr>
              </tbody>
            </table>
          )}
          <div className="grid grid-cols-[1fr_180px] gap-3">
            <Field label="Dataset name">
              <TextInput value={name} onCommit={setName} />
            </Field>
            <Field label="Positional accuracy (m)" hint="From hardware validation; blank = unknown">
              <NumberInput value={accuracy} allowNull min={0} step={0.05} onCommit={setAccuracy} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} />
            This file is synthetic / test data (not a field recording) — label it as such everywhere
            {synthetic && <Badge tone="warn">Synthetic</Badge>}
          </label>
        </div>
      )}
    </Modal>
  );
}

export function activateObserved(ds: ObservedDataset) {
  useData.getState().setActive(ds.meta.id);
  let a = Infinity;
  let b = -Infinity;
  for (const t of ds.cleanTracks) {
    if (!t.t.length) continue;
    a = Math.min(a, t.t[0]);
    b = Math.max(b, t.t[t.t.length - 1]);
  }
  if (Number.isFinite(a)) usePlayback.getState().setStudy(Math.floor(a / 3600) * 3600, Math.ceil(b / 3600) * 3600);
}

function Preview({ rows, headers }: { rows: Record<string, unknown>[]; headers: string[] }) {
  return (
    <div className="mt-3 max-h-[220px] overflow-auto rounded-[3px] border border-line-2">
      <table className="w-full text-[11px] tnum">
        <thead className="sticky top-0 bg-panel">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-2 py-1 text-left font-medium whitespace-nowrap text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line-2">
              {headers.map((h) => (
                <td key={h} className="px-2 py-0.5 whitespace-nowrap">
                  {String(r[h] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FramePreview({ points }: { points: { x: number; y: number }[] }) {
  const spatial = useProject((s) => s.project!.spatial);
  const polys = [...spatial.rooms.map((r) => r.polygon), ...spatial.circulation.map((c) => c.polygon)].filter((p) => p.length >= 3);
  const sample = points.length > 3000 ? points.filter((_, i) => i % Math.ceil(points.length / 3000) === 0) : points;
  const b = unionBBox([...polys.map(bbox), ...(sample.length ? [bbox(sample)] : [])]) ?? { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const pad = 1;
  const vb = `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  const loc = getLocator(spatial);
  const inside = sample.filter((p) => loc.locate(p.x, p.y) >= 0).length;
  return (
    <div>
      <svg viewBox={vb} className="h-[220px] w-full rounded-[3px] border border-line-2 bg-panel">
        {polys.map((p, i) => (
          <polygon key={i} points={p.map((v) => `${v.x},${v.y}`).join(' ')} fill="#e9e6e0" stroke="#b9b4ab" strokeWidth={0.08} />
        ))}
        {sample.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={0.12} fill="#2a78d6" opacity={0.5} />
        ))}
      </svg>
      <div className="mt-1 text-[11px] text-muted">{sample.length ? `${Math.round((inside / sample.length) * 100)}% of sampled points fall inside mapped spaces.` : 'No points.'}</div>
    </div>
  );
}
