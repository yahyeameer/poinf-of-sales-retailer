import type { MetadataRoute } from "next";

/**
 * layout.tsx already declares `appleWebApp: { capable: true }`, which invites
 * staff to add the till to a phone's home screen. Without a manifest that
 * invitation half-works: the app installs, but with no name of its own and no
 * icon, so it lands on the home screen as an unlabelled thumbnail among the
 * shop phone's other apps.
 *
 * `display: standalone` matters more than it looks. A till running in a
 * browser tab has an address bar a customer can type into while the cashier's
 * back is turned; standalone removes it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI POS",
    short_name: "AI POS",
    description: "Barcode-first, offline-first point of sale for small retail.",
    start_url: "/till",
    display: "standalone",
    background_color: "#07100d",
    theme_color: "#07100d",
    orientation: "portrait",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
