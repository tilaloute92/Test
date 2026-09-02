import { createContext, useCallback, useContext, useRef, useState } from 'react';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions (deletions). Default: violet, for edits. */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * App-wide confirmation dialog. Every deletion and every edit to existing data goes
 * through this so nothing changes without an explicit "Confirmer" click — including
 * dropdown/select changes (status, priority, assignee...), which is why the dialog is
 * driven by a promise rather than a fixed piece of state: it can be awaited inline from
 * an onChange handler, and if the user cancels, a controlled input simply re-renders
 * with its original value (nothing to revert manually).
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(value: boolean) => void>(() => {});

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current(value);
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => close(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{options.title}</h3>
            {options.message && <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{options.message}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => close(false)} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
                {options.cancelLabel ?? 'Annuler'}
              </button>
              <button
                onClick={() => close(true)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${
                  options.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-violet-600 hover:bg-violet-700'
                }`}
              >
                {options.confirmLabel ?? 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** Returns a function you can `await` to ask the user to confirm a deletion or an edit. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
