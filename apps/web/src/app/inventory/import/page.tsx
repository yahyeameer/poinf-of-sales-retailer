import { redirect } from "next/navigation";

import { Shell } from "@/components/Shell";
import { getTenantContext } from "@/lib/tenant";
import { ImportClient } from "./ImportClient";

export const dynamic = "force-dynamic";

export default async function CSVImportPage() {
  const ctx = await getTenantContext();
  // Import writes to the catalog, so unlike the read-only pages there is no
  // useful preview to show a signed-out visitor.
  if (!ctx) redirect("/login?next=/inventory/import");

  return (
    <Shell shopName={ctx.shopName}>
      <ImportClient currency={ctx.currency} />
    </Shell>
  );
}
