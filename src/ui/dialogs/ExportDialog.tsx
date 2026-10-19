import { FileArchive } from 'lucide-react';
import { useUI } from '@/store/uiStore';
import { useProject } from '@/store/projectStore';
import { Button, Modal } from '@/ui/components/controls';
import { downloadBlob, exportArchive, safeFileName } from '@/services/projectLifecycle';

export function ExportDialog() {
  const close = () => useUI.getState().setDialog('exportOpen', false);
  const name = useProject((s) => s.project!.meta.name);
  const notify = useUI((s) => s.notify);
  return (
    <Modal title="Export" onClose={close} footer={<Button onClick={close}>Close</Button>}>
      <div className="space-y-2">
        <ExportRow
          icon={<FileArchive size={16} />}
          title="Project archive (.bsaflow)"
          desc="Portable zip containing project JSON, the drawing PDF and imported datasets. Re-open with Open project → Import archive."
          onClick={async () => {
            downloadBlob(await exportArchive(), `${safeFileName(name)}.bsaflow`);
            notify('Project archive exported.');
          }}
        />
      </div>
    </Modal>
  );
}

export function ExportRow({ icon, title, desc, onClick, disabled }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-[3px] border border-line-2 px-3 py-2.5">
      <span className="mt-0.5 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium">{title}</div>
        <div className="text-2xs leading-relaxed text-muted">{desc}</div>
      </div>
      <Button size="sm" disabled={disabled} onClick={onClick}>
        Export
      </Button>
    </div>
  );
}
