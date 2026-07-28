import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI POS",
  description: "Point of sale for small retail",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
