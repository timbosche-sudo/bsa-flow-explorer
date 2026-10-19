import { Component, type ReactNode } from 'react';

/** Last-resort error screen; project data in IndexedDB is not affected. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-[520px] rounded-[4px] border border-line bg-paper p-5 shadow-sm">
          <div className="text-[15px] font-semibold">Something went wrong</div>
          <p className="mt-2 text-[12.5px] text-ink-2">The view failed to render. Your saved project data on this device is unaffected.</p>
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-panel p-2 text-[11px] text-err">{this.state.error.message}</pre>
          <button className="mt-3 h-7 rounded-[3px] bg-ink px-3 text-[12.5px] font-medium text-white" onClick={() => location.reload()}>
            Reload application
          </button>
        </div>
      </div>
    );
  }
}
