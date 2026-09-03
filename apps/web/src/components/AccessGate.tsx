import Link from "next/link";
import { Lock } from "lucide-react";

import { NAV_GROUPS, dashboardHref, type NavAccess } from "@/components/nav-items";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * What a page renders instead of itself when the person asking shouldn't be
 * here.
 *
 * A blank page or a bare "forbidden" reads as a bug — staff report it as one,
 * and the owner spends an evening on a support call about a rule they set
 * themselves. So this says which screen it is, why it isn't available to them,
 * and offers the way back to somewhere that is.
 *
 * It is not a security boundary. RLS refuses the rows and the RPCs refuse the
 * writes whether or not this renders; this is the part that explains it.
 */
export function AccessGate({
  href,
  access,
}: {
  /** The route being refused. Used to name it, and to pick the reason. */
  href: string;
  access: NavAccess | null;
}) {
  const label = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href)?.label ?? "This screen";
  const home = dashboardHref(access);

  const reason =
    access?.pinnedToLocation && access.locationKind === "warehouse"
      ? `${label} covers the shop floor — takings, receipts, the drawer. You're assigned to a warehouse, where none of it applies.`
      : access?.role === "cashier"
        ? `${label} is limited to owners and managers.`
        : `${label} isn't available to your account.`;

  return (
    <div className="mx-auto max-w-2xl py-6">
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={Lock}
            title={`${label} isn't available here`}
            description={
              <>
                {reason}{" "}
                {access?.pinnedToLocation
                  ? "Ask the shop owner if you need to be moved."
                  : "Ask the shop owner if you need access."}
              </>
            }
            action={
              <Link
                href={home as never}
                className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Back to your dashboard
              </Link>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
