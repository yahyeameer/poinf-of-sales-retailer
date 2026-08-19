"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Transient, non-blocking confirmations.
 *
 * The app used to answer every save with an inline <Notice> that pushed the
 * page down and was easy to miss — a cashier mid-scan would lose their place to
 * a layout shift. A toast floats above the page instead, says what happened,
 * and clears itself. Results are the same `{ ok, message }` shape the server
 * actions already return, so a flow switches over by swapping setNotice for
 * this hook.
 *
 * Inline <Notice> stays the right tool for validation that belongs beside a
 * field ("enter a quantity"); this is for the outcome of an action.
 */
type Tone = "success" | "error" | "info" | "warning";

export interface ToastInput {
  ok?: boolean;
  message: string;
  /** Overrides the tone that `ok` would pick. */
  tone?: Tone;
}

interface Toast extends ToastInput {
  id: number;
  tone: Tone;
}

const TONE_ICON: Record<Tone, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info,
};

const TONE_ACCENT: Record<Tone, string> = {
  success: "text-success",
  error: "text-destructive",
  warning: "text-warning",
  info: "text-primary",
};

const ToastContext = React.createContext<((input: ToastInput | string) => void) | null>(null);

/** Fire a toast: `toast("Saved")`, `toast({ ok: false, message: "…" })`, or a server-action result. */
export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const AUTODISMISS_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const idRef = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback((input: ToastInput | string) => {
    const normalized: ToastInput = typeof input === "string" ? { message: input } : input;
    const tone: Tone = normalized.tone ?? (normalized.ok === false ? "error" : "success");
    const id = ++idRef.current;
    setToasts((list) => [...list, { ...normalized, tone, id }]);
    window.setTimeout(() => dismiss(id), AUTODISMISS_MS);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Above the mobile tab bar; bottom-centre on a phone, bottom-right on a
          desktop. pointer-events-none on the stack so it never blocks the page;
          each toast re-enables its own. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-end sm:pb-4"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              aria-live="polite"
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-popover p-3.5 text-sm text-popover-foreground shadow-lg",
                "animate-rise",
              )}
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_ACCENT[t.tone])} aria-hidden />
              <p className="min-w-0 flex-1">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-m-1 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
