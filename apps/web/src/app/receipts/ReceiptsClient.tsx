"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime, formatMoney } from "@ai-pos/shared";
import { ReceiptText } from "lucide-react";

import { DemoBanner } from "@/components/DemoBanner";
import { useIsMounted } from "@/components/LocalTime";
import type { ReceiptShop } from "@/components/Receipt";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { refundSale, voidSale } from "@/app/till/actions";

import { ReceiptsTable } from "./components/ReceiptsTable";
import { ReceiptViewDialog } from "./components/ReceiptViewDialog";
import { RefundDialog } from "./components/RefundDialog";
import { VoidDialog } from "./components/VoidDialog";
import type { Receipt, ReceiptsDialog, RefundLine } from "./components/types";

// Re-exported so page.tsx can describe its own props without reaching into
// ./components, which is this screen's private business.
export type { Receipt, ReceiptItem } from "./components/types";

/**
 * Sales history: look one up, hand a copy over, or give the money back.
 *
 * This file owns the open dialog, the notice and the server call. Everything
 * visual lives in ./components, and the two dialogs own the fields that only
 * they use.
 */
export function ReceiptsClient({
  initialReceipts,
  currency,
  shopName,
  shop,
  canRefund,
  canVoidAny,
  demoReason,
}: {
  initialReceipts: Receipt[];
  currency: string;
  shopName: string;
  shop: ReceiptShop;
  canRefund: boolean;
  canVoidAny: boolean;
  demoReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [receipts] = useState<Receipt[]>(initialReceipts);
  const [dialog, setDialog] = useState<ReceiptsDialog>(null);
  const toast = useToast();
  const mounted = useIsMounted();

  function submitRefund(lines: RefundLine[], reason: string, restock: boolean) {
    if (dialog?.name !== "refund") return;

    if (lines.length === 0) {
      toast({ ok: false, message: "Pick at least one item to refund." });
      return;
    }

    const originalSaleId = dialog.receipt.saleId;

    startTransition(async () => {
      const result = await refundSale({
        originalSaleId,
        // Fresh per attempt: a retry after a dropped connection must be able to
        // reach the server twice without refunding the customer twice.
        clientId: crypto.randomUUID(),
        lines,
        reason: reason || null,
        method: null,
        restock,
      });

      toast(result);
      if (result.ok) {
        setDialog(null);
        router.refresh();
      }
    });
  }

  function submitVoid(reason: string) {
    if (dialog?.name !== "void") return;
    const saleId = dialog.receipt.saleId;

    startTransition(async () => {
      // No client_id here, unlike a refund. void_sale() is idempotent on the
      // sale's own status — a second call against an already-voided sale
      // returns it unchanged rather than restocking twice — so a retry needs
      // no key of its own.
      const result = await voidSale(saleId, reason || null);

      toast(result);
      if (result.ok) {
        setDialog(null);
        router.refresh();
      }
    });
  }

  // This ends up in an href, which the server renders too — so the date has to
  // agree across hydration exactly as a rendered one does. Same gate as
  // <LocalTime>: UTC until mounted, the shop's own clock thereafter.
  function whatsAppLink(r: Receipt) {
    const when = formatDateTime(r.created_at, mounted ? undefined : "UTC");
    const text = `Receipt from ${shopName}\nRef: ${r.id}\nDate: ${when}\nTotal: ${formatMoney(
      r.total_cents,
      currency,
    )}\nPayment: ${r.payment_method}\nThank you for shopping with us!`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {demoReason && <DemoBanner reason={demoReason} />}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
            <ReceiptText className="size-6 text-primary" />
            Sales history
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Look up a past sale, hand the customer another copy, or refund it.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Recent receipts</CardTitle>
          <Badge variant="secondary">{receipts.length}</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <ReceiptsTable
            receipts={receipts}
            currency={currency}
            canRefund={canRefund}
            canVoidAny={canVoidAny}
            onView={(receipt) => setDialog({ name: "view", receipt })}
            onRefund={(receipt) => {
              setDialog({ name: "refund", receipt });
            }}
            onVoid={(receipt) => {
              setDialog({ name: "void", receipt });
            }}
            whatsAppLink={whatsAppLink}
          />
        </CardContent>
      </Card>

      <ReceiptViewDialog
        receipt={dialog?.name === "view" ? dialog.receipt : null}
        shop={shop}
        onClose={() => setDialog(null)}
      />

      <RefundDialog
        receipt={dialog?.name === "refund" ? dialog.receipt : null}
        currency={currency}
        pending={pending}
        onOpenChange={(open) => !open && setDialog(null)}
        onRefund={submitRefund}
      />

      <VoidDialog
        receipt={dialog?.name === "void" ? dialog.receipt : null}
        currency={currency}
        pending={pending}
        onOpenChange={(open) => !open && setDialog(null)}
        onVoid={submitVoid}
      />
    </div>
  );
}
