"use client";

import * as React from "react";
import { AlertCircle, Loader2, Search, Send, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Ask the shop a question.
 *
 * Three things this deliberately does not do.
 *
 * It does not call itself "AI Powered". `/api/ai-query` reads figures straight
 * out of the shop's own tables and answers a fixed set of questions; there is
 * no model behind it. Badging it as intelligence sets an expectation the next
 * question breaks, and the honest framing — "I can answer these, from your
 * data" — is the one that survives contact with a shop owner.
 *
 * It does not throw the previous answer away on the next question. Asking what
 * is low and then what the average basket is are one train of thought, and a
 * box that holds exactly one reply forces you to remember the last one.
 *
 * And it does not dress failures up as answers. A dropped connection used to
 * render inside the same panel, under the same icon, in the same voice as a
 * real figure — the one place a wrong-looking number must never be able to hide.
 */

/**
 * The union is declared without the id and intersected with it below. `Omit`
 * over a discriminated union collapses it to the keys every member shares, so
 * `Omit<Turn, "id">` would quietly drop `grounded` and reject it as unknown.
 */
type TurnPayload =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; grounded: boolean }
  | { role: "error"; text: string };

type Turn = TurnPayload & { id: number };

const SUGGESTIONS = [
  "Which products are below reorder point?",
  "What is the average basket size?",
  "How are people paying — cash or mobile?",
];

/** Keeps the thread from growing without bound in a long shift. */
const MAX_TURNS = 40;

export function AiAssistant() {
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const nextId = React.useRef(1);
  const threadRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Follow the conversation down as it grows, but only within the thread's own
  // scroll box — never by moving the page under someone reading the dashboard.
  React.useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, loading]);

  function push(turn: TurnPayload) {
    setTurns((prev) => [...prev, { ...turn, id: nextId.current++ }].slice(-MAX_TURNS));
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || loading) return;

    push({ role: "user", text: q });
    setQuery("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });

      if (!res.ok) {
        // The route answers 401 with the bare word "Unauthorized", which is
        // API vocabulary, not something to put in front of a shop owner
        // mid-shift. Mapped the same way friendlyMessage() maps the database's
        // SQLSTATEs: say what to do, not what went wrong internally.
        if (res.status === 401) {
          push({ role: "error", text: "Sign in first — these answers come from your shop's own data." });
          return;
        }
        const body = await res.json().catch(() => null);
        push({
          role: "error",
          text: body?.error ?? `The lookup failed (${res.status}). Try again in a moment.`,
        });
        return;
      }

      const data = (await res.json()) as { answer?: string; error?: string; matched?: boolean };

      if (data.error) push({ role: "error", text: data.error });
      else if (data.answer)
        push({ role: "assistant", text: data.answer, grounded: data.matched !== false });
      else push({ role: "error", text: "The lookup came back empty." });
    } catch {
      push({
        role: "error",
        text: "Couldn't reach the shop's data. Check the connection and try again.",
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const started = turns.length > 0;

  return (
    <Card glow="md" className="border-primary/25 bg-linear-to-br from-primary-soft via-card to-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-b from-primary-bright to-primary text-primary-foreground glow-btn">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base font-bold">Ask your shop</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Answers read straight from your own figures — stock levels, basket size,
                payment mix.
              </p>
            </div>
          </div>

          {started && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setTurns([]);
                inputRef.current?.focus();
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {started && (
          <div
            ref={threadRef}
            // polite, not assertive: an answer arriving must not interrupt a
            // cashier who has already moved on to the till.
            aria-live="polite"
            aria-label="Conversation"
            className="max-h-72 space-y-2.5 overflow-y-auto pr-1"
          >
            {turns.map((t) => (
              <TurnBubble key={t.id} turn={t} />
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Looking it up…
              </div>
            )}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(query);
          }}
          className="flex gap-2"
        >
          <label htmlFor="ai-query" className="sr-only">
            Ask a question about your shop
          </label>
          <Input
            id="ai-query"
            ref={inputRef}
            type="text"
            autoComplete="off"
            placeholder="Ask about stock, takings or payment mix…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="animate-spin" /> : <Send />}
            <span className="hidden sm:inline">{loading ? "Asking" : "Ask"}</span>
          </Button>
        </form>

        {/* Once a conversation is going the chips are clutter — and by then the
            reader knows what kind of question lands. */}
        {!started && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={loading}
                onClick={() => ask(s)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-border bg-card",
                  "px-3 py-1.5 text-xs font-medium text-muted-foreground",
                  "transition-colors hover:border-primary/45 hover:bg-primary-soft hover:text-primary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <Search className="size-3" aria-hidden />
                {s}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TurnBubble({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-xl rounded-br-sm bg-muted px-3 py-2 text-sm text-foreground">
          {turn.text}
        </p>
      </div>
    );
  }

  if (turn.role === "error") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="min-w-0">{turn.text}</p>
      </div>
    );
  }

  // An answer the route could not ground in real data is styled as the
  // limitation it is, not as an insight — same words, honest packaging.
  return (
    <div
      className={cn(
        "max-w-[85%] rounded-xl rounded-bl-sm border px-3 py-2 text-sm",
        turn.grounded
          ? "border-primary/25 bg-primary-soft text-foreground"
          : "border-border bg-card text-muted-foreground",
      )}
    >
      {turn.text}
    </div>
  );
}
