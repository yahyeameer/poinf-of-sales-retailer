"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";

/**
 * Flow A, step 1. Creates the shop and attaches the signed-in user as owner.
 *
 * The session refresh afterwards is not optional. tenant_id is minted into the
 * JWT at token issue, so until the token is reissued the user holds a claim-less
 * one and every RLS policy denies every row — the dashboard would render an
 * empty shop the owner just created.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [taxPercent, setTaxPercent] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { error: rpcError } = await supabase.rpc("provision_tenant", {
      p_name: name,
      p_currency: currency.toUpperCase(),
      p_tax_rate: Number(taxPercent) / 100,
    });

    if (rpcError) {
      setError(rpcError.message);
      setPending(false);
      return;
    }

    await supabase.auth.refreshSession();

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-linear-to-b from-primary-bright to-primary text-primary-foreground glow-btn">
            <Store className="size-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient">
            Set up your shop
          </h1>
          <p className="text-sm text-muted-foreground">
            One shop, one set of books. You can add locations and staff next.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Shop details</CardTitle>
            <CardDescription>
              These set the currency on every price and receipt, so they are worth
              getting right now.
            </CardDescription>
          </CardHeader>

          <form onSubmit={onSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Shop name</Label>
                <Input
                  id="name"
                  required
                  maxLength={120}
                  placeholder="e.g. Hodan Mini Market"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="currency">Currency</Label>
                  <Input
                    id="currency"
                    required
                    maxLength={3}
                    className="uppercase"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tax">Tax rate (%)</Label>
                  <Input
                    id="tax"
                    type="number"
                    min="0"
                    max="99"
                    step="0.01"
                    className="tabular-nums"
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(e.target.value)}
                  />
                </div>
              </div>

              {error && <Notice tone="error">{error}</Notice>}

              <Button
                type="submit"
                size="lg"
                block="always"
                disabled={pending || name.trim() === ""}
              >
                {pending ? "Creating…" : "Create shop"}
              </Button>

              <p className="text-xs text-muted-foreground">
                Shelf prices are treated as tax-inclusive. You can change that in
                Settings.
              </p>
            </CardContent>
          </form>
        </Card>
      </div>
    </div>
  );
}
