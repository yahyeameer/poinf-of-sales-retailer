import { redirect } from "next/navigation";

import { Shell } from "@/components/Shell";
import { getShopBranding } from "@/lib/shop";
import { getTenantContext } from "@/lib/tenant";
import { SettingsClient } from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login?next=/settings");

  const shop = await getShopBranding(ctx.tenantId);
  if (!shop) {
    return (
      <Shell shopName={ctx.shopName}>
        <h1>Shop Settings</h1>
        <div className="notice">Couldn&apos;t load your shop&apos;s settings.</div>
      </Shell>
    );
  }

  return (
    <Shell shopName={ctx.shopName}>
      <SettingsClient shop={shop} canEdit={ctx.role === "owner"} tenantId={ctx.tenantId} />
    </Shell>
  );
}
