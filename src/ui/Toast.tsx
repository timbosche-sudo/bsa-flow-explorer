import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useUI } from '@/store/uiStore';
import { cx } from './components/controls';

export function Toast() {
  const toast = useUI((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), toast.tone === 'error' ? 9000 : 5500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex justify-center">
      <div
        className={cx(
          'animate-fade-in pointer-events-auto flex max-w-[560px] items-start gap-3 rounded-[4px] border px-3 py-2 text-[12.5px] shadow-lg',
          toast.tone === 'error' ? 'border-[#e8c3c3] bg-[#fdf3f3] text-err' : toast.tone === 'warn' ? 'border-[#ecd9b0] bg-[#fdf8ec] text-[#7a5410]' : 'border-line bg-paper text-ink',
        )}
        role="status"
      >
        <span className="flex-1">{toast.text}</span>
        <button onClick={() => setVisible(false)} className="text-faint hover:text-ink">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
