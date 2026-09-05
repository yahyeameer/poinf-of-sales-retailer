"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Delete, ShieldCheck, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ActionNotice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import { changeOwnTillPin, unlockTill } from "@/app/till/actions";

import type { Notice } from "./types";

export interface TillStaffOption {
  id: string;
  name: string;
  role: "owner" | "manager" | "cashier";
  mustChangePin: boolean;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

const MIN_PIN = 4;
const MAX_PIN = 8;

/**
 * Which question the keypad is currently asking.
 *
 * A one-time PIN turns unlocking into three steps, not one: prove the PIN you
 * were handed, choose your own, type it again. Keeping that in a single state
 * rather than a pile of booleans is what stops the screen showing "Unlock" and
 * "Confirm your new PIN" at the same time.
 */
type Step = "unlock" | "choose" | "confirm";

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
  const [step, setStep] = React.useState<Step>("unlock");
  const [pin, setPin] = React.useState("");
  // The PIN they proved at the "unlock" step. change_own_staff_pin() needs it
  // as the authorisation for the replacement, so it is held for the length of
  // this exchange and dropped the moment the step is left.
  const [provenPin, setProvenPin] = React.useState("");
  const [chosenPin, setChosenPin] = React.useState("");
  const [notice, setNotice] = React.useState<Notice>(null);

  function reset(to: Step = "unlock") {
    setStep(to);
    setPin("");
    if (to === "unlock") {
      setProvenPin("");
      setChosenPin("");
    }
  }

  function pick(member: TillStaffOption | null) {
    setSelected(member);
    setNotice(null);
    reset("unlock");
  }

  function submit() {
    if (!selected || pin.length < MIN_PIN) return;

    if (step === "choose") {
      // Nothing has been sent yet — this only moves to the confirmation, so a
      // mistyped new PIN is caught here rather than becoming the real one.
      setChosenPin(pin);
      setPin("");
      setNotice(null);
      setStep("confirm");
      return;
    }

    startTransition(async () => {
      if (step === "confirm") {
        if (pin !== chosenPin) {
          setNotice({ ok: false, message: "Those didn't match. Choose a new PIN again." });
          setChosenPin("");
          setPin("");
          setStep("choose");
          return;
        }

        const result = await changeOwnTillPin(selected.id, provenPin, pin);
        setNotice(result);
        if (result.ok) {
          reset();
          router.refresh();
        } else {
          // Back to the start of the change, not to the unlock: the old PIN was
          // already proved, and asking for it again would be theatre.
          setChosenPin("");
          setPin("");
          setStep("choose");
        }
        return;
      }

      const result = await unlockTill(selected.id, pin);

      // A correct PIN that cannot be used yet. The server withholds the till
      // rather than handing it over, so the only way on is through a new PIN.
      if (result.code === "must_change_pin") {
        setProvenPin(pin);
        setPin("");
        setStep("choose");
        setNotice({ ok: true, message: result.message });
        return;
      }

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
    setPin((p) => (p + key).slice(0, MAX_PIN));
  }

  const copy = {
    unlock: {
      title: "Who's on the till?",
      blurb:
        "Every sale is recorded against whoever unlocks it, so the day's takings can be traced back to a person rather than to the phone.",
      action: selected ? `Unlock as ${selected.name}` : "Unlock",
    },
    choose: {
      title: "Choose your own PIN",
      blurb:
        "The PIN you were given is known to whoever gave it to you. Pick one only you know — 4 to 8 digits.",
      action: "Continue",
    },
    confirm: {
      title: "Type it once more",
      blurb: "Just to be sure it is the PIN you meant.",
      action: "Save and unlock",
    },
  }[step];

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-5 aurora">
      <div className="space-y-2 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary glow-md">
          {step === "unlock" ? (
            <UserRound className="size-5" />
          ) : (
            <ShieldCheck className="size-5" />
          )}
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-gradient">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.blurb}</p>
      </div>

      <ActionNotice result={notice} />

      <Card glow="md">
        <CardContent className="space-y-4 p-5">
          {/* The roster disappears once a PIN change is under way: at that
              point the person is settled and switching would throw away a PIN
              they have already proved. */}
          {step === "unlock" ? (
            <div className="flex flex-wrap gap-2">
              {staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pick(s)}
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
          ) : (
            <button
              type="button"
              onClick={() => {
                pick(null);
                setSelected(staff.length === 1 ? staff[0]! : null);
              }}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Not {selected?.name}? Start again
            </button>
          )}

          {selected && (
            <>
              {/* Dots, not the digits. A till faces the shop. */}
              <div
                className="flex justify-center gap-2.5 py-1"
                role="status"
                aria-label={`${pin.length} of up to ${MAX_PIN} digits entered`}
              >
                {Array.from({ length: Math.max(MIN_PIN, pin.length) }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "size-3 rounded-full transition-colors",
                      i < pin.length ? "bg-primary" : "bg-muted",
                    )}
                  />
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2.5">
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
                      // A thumb on a counter, not a mouse. 64px comfortably
                      // clears the 44px minimum and survives a wet hand.
                      className="h-16 text-xl font-semibold active:scale-[0.97]"
                    >
                      {k === "del" ? <Delete className="size-5" /> : k}
                    </Button>
                  ),
                )}
              </div>

              <Button
                type="button"
                className="h-14 w-full text-base"
                disabled={pending || pin.length < MIN_PIN}
                onClick={submit}
              >
                {pending ? "Checking…" : copy.action}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
