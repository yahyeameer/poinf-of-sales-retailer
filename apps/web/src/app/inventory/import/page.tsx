import { Shell } from "@/components/Shell";
import { getTenantContext } from "@/lib/tenant";
import { ImportClient } from "./ImportClient";

export const dynamic = "force-dynamic";

export default async function CSVImportPage() {
  const ctx = await getTenantContext();

  return (
    <Shell shopName={ctx?.shopName ?? "Demo Retail Shop"}>
      <ImportClient currency={ctx?.currency ?? "USD"} />
    </Shell>
  );
}
