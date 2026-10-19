import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: ReactNode;
};

export function Button({ variant = 'default', size = 'md', icon, className, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-[3px] font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none select-none',
        size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12.5px]',
        variant === 'primary' && 'bg-ink text-white hover:bg-ink-2',
        variant === 'default' && 'bg-paper border border-line text-ink hover:border-[#cfcac3] hover:bg-panel',
        variant === 'ghost' && 'text-ink-2 hover:bg-black/5',
        variant === 'danger' && 'bg-paper border border-line text-err hover:bg-[#fbeeee]',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  title,
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; active?: boolean }) {
  return (
    <button
      {...rest}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-[3px] transition-colors disabled:opacity-35 disabled:pointer-events-none',
        active ? 'bg-ink text-white' : 'text-ink-2 hover:bg-black/[0.06]',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-2xs font-medium uppercase tracking-[0.06em] text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-faint">{hint}</span>}
    </label>
  );
}

const inputCls =
  'h-7 w-full rounded-[3px] border border-line bg-paper px-2 text-[12.5px] text-ink outline-none transition-colors focus:border-accent placeholder:text-faint';

export function TextInput({
  value,
  onCommit,
  placeholder,
  multiline,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  if (multiline) {
    return (
      <textarea
        className={cx(inputCls, 'h-auto min-h-[56px] py-1.5 leading-snug resize-y', className)}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
      />
    );
  }
  return (
    <input
      className={cx(inputCls, className)}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

export function NumberInput({
  value,
  onCommit,
  min,
  max,
  step,
  suffix,
  className,
  allowNull,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  allowNull?: boolean;
}) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => setV(value == null ? '' : String(value)), [value]);
  const commit = () => {
    if (v.trim() === '' && allowNull) return value !== null && onCommit(null);
    let n = Number(v);
    if (!Number.isFinite(n)) return setV(value == null ? '' : String(value));
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    if (n !== value) onCommit(n);
    else setV(String(n));
  };
  return (
    <div className={cx('relative', className)}>
      <input
        type="number"
        className={cx(inputCls, 'tnum', suffix && 'pr-8')}
        value={v}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-2xs text-faint">{suffix}</span>}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={cx('relative', className)}>
      <select className={cx(inputCls, 'appearance-none pr-6')} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Toggle({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={cx('flex cursor-pointer items-center justify-between gap-2 py-0.5 text-[12.5px] select-none', className)}>
      {label && <span className="text-ink-2">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-[16px] w-[28px] shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-[#cfcbc4]')}
      >
        <span className={cx('absolute top-[2px] h-3 w-3 rounded-full bg-white shadow-sm transition-all', checked ? 'left-[14px]' : 'left-[2px]')} />
      </button>
    </label>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step,
  label,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  label?: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="py-0.5">
      {label && (
        <div className="mb-0.5 flex justify-between text-[12px] text-ink-2">
          <span>{label}</span>
          <span className="tnum text-muted">{format ? format(value) : value}</span>
        </div>
      )}
      <input type="range" className="h-4 w-full" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cx('inline-flex rounded-[3px] border border-line bg-paper p-[2px]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-[2px] px-2 font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'h-5 text-[11px]' : 'h-6 text-[12px]',
            value === o.value ? 'bg-ink text-white' : 'text-ink-2 hover:bg-black/5',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({
  title,
  icon,
  open,
  onToggle,
  actions,
  children,
  badge,
}: {
  title: string;
  icon?: ReactNode;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <section className="border-b border-line-2">
      <div className="flex h-9 items-center gap-2 px-3">
        <button type="button" onClick={onToggle} className="flex flex-1 items-center gap-2 text-left">
          <ChevronDown size={13} className={cx('text-faint transition-transform', !open && '-rotate-90')} />
          {icon && <span className="text-muted">{icon}</span>}
          <span className="text-[11.5px] font-semibold tracking-[0.04em] text-ink uppercase">{title}</span>
          {badge}
        </button>
        {actions}
      </div>
      {open && <div className="px-3 pt-0.5 pb-3">{children}</div>}
    </section>
  );
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'sim' | 'obs' | 'warn' | 'err' | 'ok' | 'accent'; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[2px] px-1.5 py-[1px] text-[10.5px] font-semibold tracking-[0.04em] uppercase',
        tone === 'neutral' && 'bg-line-2 text-muted',
        tone === 'sim' && 'bg-sim-bg text-sim',
        tone === 'obs' && 'bg-obs-bg text-obs',
        tone === 'warn' && 'bg-[#fbf0d9] text-warn',
        tone === 'err' && 'bg-[#f8e3e3] text-err',
        tone === 'ok' && 'bg-[#e3f1e8] text-ok',
        tone === 'accent' && 'bg-accent-soft text-accent-2',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, quality }: { label: string; value: ReactNode; sub?: ReactNode; quality?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-2xs font-medium tracking-[0.05em] text-muted uppercase">
        <span className="truncate">{label}</span>
        {quality}
      </div>
      <div className="tnum mt-0.5 text-[17px] leading-tight font-semibold text-ink">{value}</div>
      {sub && <div className="tnum mt-0.5 text-2xs text-muted">{sub}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, width = 520 }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d2327]/35 p-6" onMouseDown={onClose}>
      <div
        className="animate-fade-in flex max-h-full w-full flex-col overflow-hidden rounded-[4px] border border-line bg-paper shadow-[0_20px_60px_-20px_rgba(0,0,0,0.35)]"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 shrink-0 items-center border-b border-line-2 px-4 text-[13.5px] font-semibold">{title}</div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-line-2 bg-panel px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-[3px] border border-dashed border-line px-3 py-4 text-center text-[12px] text-muted">{children}</div>;
}
