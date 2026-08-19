import type { Metadata, Viewport } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { THEME_STORAGE_KEY } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AI POS", template: "%s · AI POS" },
  description: "Barcode-first, offline-first point of sale for small retail.",
  applicationName: "AI POS",
  appleWebApp: { capable: true, title: "AI POS", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The till has 16px inputs precisely so iOS does not zoom on focus; letting
  // the user pinch out is still fine and is an accessibility requirement.
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6fbf9" },
    { media: "(prefers-color-scheme: dark)", color: "#07100d" },
  ],
};

/**
 * Runs before first paint, so the correct ground is painted once instead of
 * flashing white and correcting. Inlined as a string because a React component
 * or an imported module would both run too late — after hydration.
 *
 * Kept in sync with components/theme-provider.tsx.
 */
const themeScript = `(function(){try{
var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
var d=s==='dark'||((s===null||s==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);
var r=document.documentElement;
r.classList.toggle('dark',d);
r.style.colorScheme=d?'dark':'light';
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The head script mutates <html class>, which the server cannot predict.
    // Without this React logs a hydration mismatch on every page load.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
