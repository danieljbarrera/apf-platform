'use client';
import React, { createContext, useContext, useState, useCallback } from 'react';

type ToastType = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; type: ToastType };
type Ctx = { toast: (message: string, type?: ToastType) => void };

const ToastCtx = createContext<Ctx>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

const BG: Record<ToastType, string> = {
  success: '#38614a',
  error: '#7c3030',
  info: '#2d3748',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999, pointerEvents: 'none', alignItems: 'center' }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background: BG[t.type], color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.25)', whiteSpace: 'nowrap', animation: 'toastIn 0.2s ease', fontFamily: 'var(--sans)' }}>
            {t.type === 'success' ? '✓ ' : t.type === 'error' ? '✕ ' : ''}{t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
