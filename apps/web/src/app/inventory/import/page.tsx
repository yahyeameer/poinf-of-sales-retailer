import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { ImportClient } from "./ImportClient";

export const dynamic = "force-dynamic";

export default async function CSVImportPage() {
  let shopName = "Demo Retail Shop";

  try {
    const supabase = await createClient();
    const { data: tenant } = await supabase.from("tenants").select("name").single();
    if (tenant?.name) shopName = tenant.name;
  } catch {
    // Demo fallback for local preview
  }

  return (
    <Shell shopName={shopName}>
      <ImportClient />
    </Shell>
  );
}
