"use client";

import { useState } from "react";

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
    <div className="ai-assistant-card">
      <div className="ai-header">
        <div className="ai-title">
          <span className="ai-icon">✨</span>
          <span>AI Shop Assistant</span>
        </div>
        <span className="pill">Powered by LLM Prompts</span>
      </div>

      <div className="ai-input-group">
        <input
          type="text"
          placeholder="Ask anything about your stock, revenue, or sales trends..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button
          type="button"
          onClick={() => handleSearch()}
          disabled={loading || !query.trim()}
          style={{ width: "auto", marginTop: 0 }}
        >
          {loading ? "Analyzing..." : "Ask AI"}
        </button>
      </div>

      <div className="quick-prompts">
        {quickPrompts.map((p) => (
          <button
            key={p}
            type="button"
            className="chip-button"
            onClick={() => {
              setQuery(p);
              handleSearch(p);
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {answer && (
        <div className="ai-response">
          <strong>AI Insights:</strong>
          <p>{answer}</p>
        </div>
      )}
    </div>
  );
}
