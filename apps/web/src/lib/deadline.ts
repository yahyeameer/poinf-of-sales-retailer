/**
 * Bound how long an await may take.
 *
 * Aborting the underlying fetch is not enough, which is the whole reason this
 * exists. supabase-js retries a failed token refresh on its own schedule and
 * against its own internal deadline; cancelling each socket just makes every
 * attempt fail faster while the retry loop keeps going. Measured against a
 * Supabase that accepts connections and never answers — what a paused
 * free-tier project looks like — one page render still took 57 seconds after
 * the socket deadline cut its network attempts from thirteen to four.
 *
 * On Vercel that is a gateway timeout on every plan below Pro, so the visitor
 * gets an error page regardless of how carefully the code degrades. The only
 * reliable bound is at the call site: stop waiting, whatever the library is
 * still doing.
 *
 * The abandoned work is not cancelled — it cannot be — but it is no longer on
 * the critical path, and the socket deadline in supabase/server.ts stops it
 * doing anything expensive in the background.
 */

export class DeadlineExceededError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} exceeded its ${ms}ms budget`);
    this.name = "DeadlineExceededError";
  }
}

export function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  // The loser of the race still settles later. Without this, a rejection
  // arriving after the deadline is an unhandled rejection, which in Node is
  // fatal by default — a timeout would take the whole server down.
  work.catch(() => {});

  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(label, ms)), ms);
  });

  return Promise.race([work, guard]).finally(() => clearTimeout(timer));
}
