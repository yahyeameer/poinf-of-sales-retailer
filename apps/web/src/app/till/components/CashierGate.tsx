"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Delete, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ActionNotice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import { unlockTill } from "@/app/till/actions";

import type { Notice } from "./types";

export interface TillStaffOption {
  id: string;
  name: string;
  role: "owner" | "manager" | "cashier";
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

/**
 * Who is on the till.
 *
 * The shop phone stays signed in all day and staff take turns on it, so
 * without this every sale is credited to the account, not the person. Staff
 * here may have no login of their own at all — that is the case
 * 20260808000100_staff_without_logins.sql was written for — so a PIN is the
 * only identity they have.
 *
 * An on-screen keypad rather than a text input: this is a phone propped on a
 * counter, the entry is always four to eight digits, and the native numeric
 * keyboard covers half the screen on the way in and out between customers.
 */
export function CashierGate({
  staff,
  currency: _currency,
}: {
  staff: TillStaffOption[];
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [selected, setSelected] = React.useState<TillStaffOption | null>(
    staff.length === 1 ? staff[0]! : null,
  );
  const [pin, setPin] = React.useState("");
  const [notice, setNotice] = React.useState<Notice>(null);

  function submit(value: string) {
    if (!selected) return;
    startTransition(async () => {
      const result = await unlockTill(selected.id, value);
      setNotice(result);
      setPin("");
      if (result.ok) router.refresh();
    });
  }

  function press(key: string) {
    if (pending) return;
    if (key === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    setPin((p) => {
      const next = (p + key).slice(0, 8);
      // Four digits is the shortest a PIN can be, so nothing is submitted
      // early; anything longer is confirmed with the button.
      return next;
    });
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-5 aurora">
      <div className="space-y-2 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary glow-md">
          <UserRound className="size-5" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-gradient">Who&apos;s on the till?</h1>
        <p className="text-sm text-muted-foreground">
          Every sale is recorded against whoever unlocks it, so the day&apos;s takings can be
          traced back to a person rather than to the phone.
        </p>
      </div>

      <ActionNotice result={notice} />

      <Card glow="md">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap gap-2">
            {staff.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSelected(s);
                  setPin("");
                  setNotice(null);
                }}
                aria-pressed={selected?.id === s.id}
                className={cn(
                  "min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected?.id === s.id
                    ? "border-primary/45 bg-primary-soft text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {s.name}
                <span className="ml-1.5 text-[10px] font-normal capitalize opacity-70">
                  {s.role}
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <>
              {/* Dots, not the digits. A till faces the shop. */}
              <div
                className="flex justify-center gap-2.5 py-1"
                role="status"
                aria-label={`${pin.length} of up to 8 digits entered`}
              >
                {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "size-3 rounded-full transition-colors",
                      i < pin.length ? "bg-primary" : "bg-muted",
                    )}
                  />
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {KEYS.map((k, i) =>
                  k === "" ? (
                    <span key={`gap-${i}`} />
                  ) : (
                    <Button
                      key={k}
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => press(k)}
                      aria-label={k === "del" ? "Delete last digit" : k}
                      className="h-14 text-lg font-semibold"
                    >
                      {k === "del" ? <Delete className="size-5" /> : k}
                    </Button>
                  ),
                )}
              </div>

              <Button
                type="button"
                className="w-full"
                disabled={pending || pin.length < 4}
                onClick={() => submit(pin)}
              >
                {pending ? "Checking…" : `Unlock as ${selected.name}`}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
