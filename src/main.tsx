import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Development-only handle for automated UI testing.
if (import.meta.env.DEV) {
  void Promise.all([import('@/store/projectStore'), import('@/store/viewStore'), import('@/store/uiStore'), import('@/store/dataStore'), import('@/store/playback')]).then(
    ([p, v, u, d, pb]) => {
      (window as unknown as Record<string, unknown>).__bsa = { project: p.useProject, view: v.useView, ui: u.useUI, data: d.useData, playback: pb.usePlayback, clock: pb.clock };
    },
  );
}
