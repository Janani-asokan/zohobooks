import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; title: string; message?: string }

const ToastContext = createContext<(kind: Kind, title: string, message?: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((kind: Kind, title: string, message?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, title, message }]);
    setTimeout(() => dismiss(id), 3800);
  }, []);
  const Icon = { success: CheckCircle2, error: AlertTriangle, info: Info };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => {
          const I = Icon[t.kind];
          return (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              <I size={18} className="toast-icon" />
              <div className="toast-body">
                <strong>{t.title}</strong>
                {t.message && <span>{t.message}</span>}
              </div>
              <button className="icon-btn sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
