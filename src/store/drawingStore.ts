/** Loaded PDF drawing (runtime only; the PDF bytes persist in IndexedDB). */
import { create } from 'zustand';
import type { FloorPlanSource } from '@/domain/types';
import { getBlob } from '@/services/persistence';
import { openPdf, type PDFDocumentProxy, type PDFPageProxy } from '@/services/pdf';

interface DrawingState {
  key: string | null;
  doc: PDFDocumentProxy | null;
  page: PDFPageProxy | null;
  pageIndex: number;
  status: 'none' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Bumped whenever a new page is ready (for layers to re-render). */
  version: number;
  ensure: (src: FloorPlanSource) => Promise<void>;
  /** Load directly from bytes (used right after upload). */
  loadBytes: (key: string, bytes: ArrayBuffer, pageIndex: number) => Promise<PDFDocumentProxy>;
  clear: () => void;
}

const sourceKey = (src: FloorPlanSource) => src.blobKey ?? src.bundledUrl ?? null;

export const useDrawing = create<DrawingState>((set, get) => ({
  key: null,
  doc: null,
  page: null,
  pageIndex: 0,
  status: 'none',
  error: null,
  version: 0,
  ensure: async (src) => {
    const key = sourceKey(src);
    const st = get();
    if (!key) {
      if (st.key) set({ key: null, doc: null, page: null, status: 'none', version: st.version + 1 });
      return;
    }
    if (st.key === key && st.doc) {
      if (st.pageIndex !== src.pageIndex && src.pageIndex < st.doc.numPages) {
        const page = await st.doc.getPage(src.pageIndex + 1);
        set({ page, pageIndex: src.pageIndex, version: get().version + 1 });
      }
      return;
    }
    set({ key, status: 'loading', error: null });
    try {
      let doc: PDFDocumentProxy;
      if (src.blobKey) {
        const blob = await getBlob(src.blobKey);
        if (!blob) throw new Error('The drawing file is missing from local storage. Re-import the PDF.');
        doc = await openPdf(await blob.arrayBuffer());
      } else {
        doc = await openPdf(`${import.meta.env.BASE_URL}${src.bundledUrl}`);
      }
      if (get().key !== key) return;
      const idx = Math.min(src.pageIndex, doc.numPages - 1);
      const page = await doc.getPage(idx + 1);
      set({ doc, page, pageIndex: idx, status: 'ready', version: get().version + 1 });
    } catch (e) {
      if (get().key !== key) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e), doc: null, page: null });
    }
  },
  loadBytes: async (key, bytes, pageIndex) => {
    set({ key, status: 'loading', error: null });
    const doc = await openPdf(bytes.slice(0));
    const page = await doc.getPage(Math.min(pageIndex, doc.numPages - 1) + 1);
    set({ doc, page, pageIndex, status: 'ready', version: get().version + 1 });
    return doc;
  },
  clear: () => set({ key: null, doc: null, page: null, status: 'none', version: get().version + 1 }),
}));
