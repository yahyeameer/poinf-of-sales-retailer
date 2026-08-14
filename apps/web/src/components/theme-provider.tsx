"use client";

import * as React from "react";

import { THEME_STORAGE_KEY, type ResolvedTheme, type Theme } from "@/lib/theme";

export type { Theme, ResolvedTheme };

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** light → dark → light. "system" resolves first, so one tap always flips. */
  toggle: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStored(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  } catch {
    // Private mode / storage disabled. Not worth failing the app over.
    return "system";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Deliberately "system" on the server and on first client render. The real
  // value is applied to <html> by the head script before paint, so the DOM is
  // already correct; starting from the stored value here instead would make the
  // server and client markup disagree and trip hydration.
  const [theme, setThemeState] = React.useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>("light");

  React.useEffect(() => {
    const stored = readStored();
    setThemeState(stored);
    setResolvedTheme(stored === "system" ? systemTheme() : stored);
  }, []);

  const apply = React.useCallback((next: ResolvedTheme) => {
    const root = document.documentElement;
    root.classList.toggle("dark", next === "dark");
    // Makes native widgets (scrollbars, date pickers, form controls) follow the
    // app rather than the OS, which is the tell that a toggle is only skin-deep.
    root.style.colorScheme = next;
    setResolvedTheme(next);
  }, []);

  const setTheme = React.useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      apply(next === "system" ? systemTheme() : next);
    },
    [apply],
  );

  // Only while following the OS. Once the user picks a side we stop listening,
  // otherwise their choice gets stomped when the OS flips at sunset.
  React.useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, apply]);

  // Another tab changed the preference — follow it.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next = readStored();
      setThemeState(next);
      apply(next === "system" ? systemTheme() : next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [apply]);

  const toggle = React.useCallback(
    () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    [resolvedTheme, setTheme],
  );

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggle }),
    [theme, resolvedTheme, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
