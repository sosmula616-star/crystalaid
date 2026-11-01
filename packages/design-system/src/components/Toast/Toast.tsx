import * as RadixToast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CloseIcon } from '../icons.js';
import styles from './Toast.module.css';

export type ToastTone = 'success' | 'warning' | 'danger';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before it closes by itself. Default 5000, danger 10000. */
  duration?: number;
}

interface ToastEntry extends ToastInput {
  id: number;
  open: boolean;
}

const DEFAULT_DURATION = 5000;
const DANGER_DURATION = 10000;
const FALLBACK_EXIT_MS = 180;

/** The --motion-base token in milliseconds, so exit matches the CSS animation. */
function exitDelay(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--motion-base').trim();
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return FALLBACK_EXIT_MS;
  if (raw.endsWith('ms')) return value;
  return raw.endsWith('s') ? value * 1000 : FALLBACK_EXIT_MS;
}

interface ToastApi {
  show(input: ToastInput): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Accessible name of the notification region. */
  regionLabel?: string;
}

/**
 * Toasts stack at the bottom of the screen, clear of the safe-area insets.
 * Set the `--toast-bottom-offset` CSS variable (default 0) to lift them above
 * a bottom navigation.
 */
export function ToastProvider({ children, closeLabel = 'Close', regionLabel = 'Notifications' }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const show = useCallback((input: ToastInput) => {
    nextId.current += 1;
    const entry = { ...input, id: nextId.current, open: true };
    setToasts((current) => [...current, entry]);
  }, []);

  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
    };
  }, []);

  // Close first so the exit animation plays, then drop the entry.
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, open: false } : toast)));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, exitDelay());
    timers.current.add(timer);
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      <RadixToast.Provider label={regionLabel} swipeDirection="down">
        {children}
        {toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            open={toast.open}
            duration={toast.duration ?? (toast.tone === 'danger' ? DANGER_DURATION : DEFAULT_DURATION)}
            // Errors interrupt the screen reader; other tones wait their turn.
            type={toast.tone === 'danger' ? 'foreground' : 'background'}
            className={[styles.toast, styles[toast.tone ?? 'success']].join(' ')}
            onOpenChange={(open) => {
              if (!open) dismiss(toast.id);
            }}
          >
            <div className={styles.text}>
              <RadixToast.Title className={styles.title}>{toast.title}</RadixToast.Title>
              {toast.description ? (
                <RadixToast.Description className={styles.description}>{toast.description}</RadixToast.Description>
              ) : null}
            </div>
            <RadixToast.Close className={styles.close} aria-label={closeLabel}>
              <CloseIcon />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className={styles.viewport} label={`${regionLabel} ({hotkey})`} />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside a ToastProvider');
  return api;
}
