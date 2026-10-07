import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M4 22 L16 28 L28 22 L28 10 L16 16 L4 10 Z" fill="var(--accent)" opacity=".18" />
        <path d="M4 10 L16 4 L28 10 L16 16 Z" fill="none" stroke="var(--fg)" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M4 10 V22 L16 28 V16 M28 10 V22 L16 28" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span className="name">Plan Relief</span>
    </div>
  );
}

export function Modal({ title, children, footer, onClose, wide }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-h"><h2>{title}</h2></div>
        <div className="modal-b">{children}</div>
        <div className="modal-f">{footer}</div>
      </div>
    </div>
  );
}

/* ---------- Confirmation systématique avant suppression ou écrasement ---------- */
interface ConfirmOptions { title: string; message: ReactNode; confirmLabel: string; danger?: boolean }
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          title={state.title}
          onClose={() => close(false)}
          footer={<>
            <button type="button" className="btn" onClick={() => close(false)}>Annuler</button>
            <button type="button" className={`btn ${state.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>{state.confirmLabel}</button>
          </>}
        >
          <div>{state.message}</div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

/* ---------- Messages éphémères ---------- */
type Toast = { text: string; kind: 'ok' | 'error' | 'warn' | '' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef(0);
  const show = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    setToast({ text, kind });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 9000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={`notice toast ${toast.kind}`} role="status" onClick={() => setToast(null)}>{toast.text}</div>}
    </ToastCtx.Provider>
  );
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter((t) => t.length > 0);
  if (!terms.length || !text) return <>{text}</>;
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const n = norm(text);
  const marks = new Array(text.length).fill(false);
  for (const t of terms.map(norm)) {
    let i = n.indexOf(t);
    while (t && i >= 0) { for (let k = i; k < i + t.length; k++) marks[k] = true; i = n.indexOf(t, i + t.length); }
  }
  const out: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const on = marks[i];
    let j = i;
    while (j < text.length && marks[j] === on) j++;
    out.push(on ? <mark key={i}>{text.slice(i, j)}</mark> : text.slice(i, j));
    i = j;
  }
  return <>{out}</>;
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(n / 1024))} ko`);
export const fmtNum = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Certains navigateurs ignorent un nom de fichier accentué et enregistrent « download » :
  // on retire accents et caractères interdits par Windows.
  a.download = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w .()-]+/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Rappel des gestes de navigation dans la vue 3D (souris, pavé tactile, écran tactile). */
export function NavHint() {
  return (
    <div className="navhint" aria-label="Se déplacer dans la vue">
      <span><b>Glisser</b> : se déplacer</span>
      <span><b>Molette</b> : zoomer vers le pointeur</span>
      <span><b>Clic droit + glisser</b> : tourner</span>
      <span><b>Flèches</b> : se déplacer (après un clic sur la vue)</span>
    </div>
  );
}
