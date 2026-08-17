"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center p-6 text-center font-sans">
        <h1 className="text-3xl font-bold tracking-tight">System Error</h1>
        <p className="mt-2 text-sm text-gray-500">A critical error occurred. Please try reloading.</p>
        <button
          onClick={() => reset()}
          className="mt-6 rounded-lg bg-black px-4 py-2 text-sm text-white"
        >
          Reload App
        </button>
      </body>
    </html>
  );
}
