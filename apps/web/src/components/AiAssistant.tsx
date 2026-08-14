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
    <Card className="border-emerald-200 dark:border-emerald-900 bg-gradient-to-br from-emerald-50/50 via-white to-slate-50 dark:from-emerald-950/20 dark:via-slate-900 dark:to-slate-950 shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              AI Copilot Assistant
            </CardTitle>
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
            className="flex-1 border-slate-200 focus-visible:ring-emerald-600"
          />
          <Button
            onClick={() => handleSearch()}
            disabled={loading || !query.trim()}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
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
              className="text-xs px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-emerald-50 hover:border-emerald-300 dark:hover:bg-emerald-950/50 text-slate-600 dark:text-slate-400 font-medium transition-all"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Response Box */}
        {answer && (
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1.5 animate-rise">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              <Bot className="h-4 w-4" />
              <span>AI Insights</span>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              {answer}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
