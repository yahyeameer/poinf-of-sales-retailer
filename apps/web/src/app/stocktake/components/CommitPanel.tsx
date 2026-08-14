"use client";

import * as React from "react";
import { ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";

/**
 * Committing the count. The note goes nowhere else, so it lives here.
 *
 * The line count is on the button rather than beside it: this writes to the
 * stock ledger, and the number of corrections is the thing to check before
 * pressing it, not after.
 */
export function CommitPanel({
  countedLines,
  changedLines,
  pending,
  onCommit,
}: {
  countedLines: number;
  changedLines: number;
  pending: boolean;
  onCommit: (note: string) => void;
}) {
  const [note, setNote] = React.useState("");

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="st-note">Note (optional)</Label>
          <Input
            id="st-note"
            type="text"
            placeholder="e.g. month-end count, back shelves"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="button"
            disabled={pending || countedLines === 0}
            onClick={() => {
              onCommit(note.trim());
              setNote("");
            }}
          >
            <ClipboardCheck />
            {pending
              ? "Committing…"
              : `Commit count (${countedLines} line${countedLines === 1 ? "" : "s"})`}
          </Button>
        </div>

        {changedLines > 0 && (
          <Notice tone="warning">
            This writes {changedLines} correction{changedLines === 1 ? "" : "s"} to the
            ledger. Existing entries are never edited — corrections are new rows.
          </Notice>
        )}
      </CardContent>
    </Card>
  );
}
