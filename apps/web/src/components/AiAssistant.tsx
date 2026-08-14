"use client";

import { useState } from "react";
import { Sparkles, Send, Loader2, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AiAssistant() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  const quickPrompts = [
    "Which products are below reorder point?",
    "What is the average transaction value?",
    "Show revenue breakdown by payment method",
  ];

  async function handleSearch(textToRun?: string) {
    const q = textToRun ?? query;
    if (!q.trim()) return;

    setLoading(true);
    setAnswer(null);

    try {
      const res = await fetch("/api/ai-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (data.answer) {
        setAnswer(data.answer);
      } else if (data.error) {
        setAnswer(`Error: ${data.error}`);
      } else {
        setAnswer("No insights found for this query.");
      }
    } catch {
      setAnswer("Failed to process AI query. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card glow="md" className="border-primary/25 bg-linear-to-br from-primary-soft via-card to-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-linear-to-b from-primary-bright to-primary text-primary-foreground glow-btn">
              <Sparkles className="size-4" />
            </div>
            <CardTitle className="text-base font-bold">AI Copilot Assistant</CardTitle>
          </div>
          <Badge variant="default" className="text-[10px]">
            AI Powered
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Input Bar */}
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Ask anything about your stock, revenue, or sales trends..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1"
          />
          <Button onClick={() => handleSearch()} disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="animate-spin" /> : <Send />}
            <span>{loading ? "Analyzing" : "Ask"}</span>
          </Button>
        </div>

        {/* Quick Suggestion Chips */}
        <div className="flex flex-wrap gap-2">
          {quickPrompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setQuery(p);
                handleSearch(p);
              }}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary-soft hover:text-primary"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Response Box */}
        {answer && (
          <div className="animate-rise space-y-1.5 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-bold text-primary">
              <Bot className="size-4" />
              <span>AI Insights</span>
            </div>
            <p className="text-sm leading-relaxed text-foreground">{answer}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
