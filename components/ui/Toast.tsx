'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ push: () => undefined, dismiss: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `t-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      const duration = toast.duration ?? (toast.tone === 'error' ? 7000 : 3800);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <span aria-hidden="true">{toast.tone === 'error' ? '!' : toast.tone === 'success' ? '✓' : '•'}</span>
            <div className="toast__body">{toast.message}</div>
            {toast.action ? (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            ) : (
              <button type="button" className="toast__action" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
