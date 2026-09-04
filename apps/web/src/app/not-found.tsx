import Link from "next/link";

export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">404 - Page Not Found</h1>
      <p className="mt-2 text-muted-foreground">The page you are looking for does not exist or has been moved.</p>
      {/* Link, not <a>: an anchor here throws away the loaded app and
          re-downloads it, which on a shop phone over a bad connection is the
          difference between a stray tap and a minute of waiting. The label
          also said "Till" while the href went to the dashboard. */}
      <Link
        href="/till"
        className="mt-6 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Return to Till
      </Link>
    </main>
  );
}
