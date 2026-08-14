/**
 * Shared by the client-side ThemeProvider and the pre-paint script that the
 * server component in app/layout.tsx inlines into <head>.
 *
 * It lives here rather than in theme-provider.tsx because that file is
 * "use client": Next turns such a module into a client-reference proxy, and
 * reading a plain constant off it from a server component is not reliable.
 */
export const THEME_STORAGE_KEY = "aipos-theme";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
