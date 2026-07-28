"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

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
    <div className="auth">
      <form onSubmit={onSubmit}>
        <h1>Set up your shop</h1>

        <label htmlFor="name">Shop name</label>
        <input
          id="name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label htmlFor="currency">Currency</label>
        <input
          id="currency"
          required
          maxLength={3}
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
        />

        <label htmlFor="tax">Tax rate (%)</label>
        <input
          id="tax"
          type="number"
          min="0"
          max="99"
          step="0.01"
          value={taxPercent}
          onChange={(e) => setTaxPercent(e.target.value)}
        />

        <button type="submit" disabled={pending || name.trim() === ""}>
          {pending ? "Creating…" : "Create shop"}
        </button>

        {error && <p className="error">{error}</p>}

        <p className="hint">
          Shelf prices are treated as tax-inclusive. You can change that in Settings.
        </p>
      </form>
    </div>
  );
}
