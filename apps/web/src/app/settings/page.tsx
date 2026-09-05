import { redirect } from "next/navigation";

import { Shell } from "@/components/Shell";
import { Notice } from "@/components/ui/notice";
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
        <div className="mx-auto max-w-7xl space-y-6">
          <h1 className="text-2xl font-bold tracking-tight text-gradient">Shop settings</h1>
          <Notice tone="error">Couldn&apos;t load your shop&apos;s settings.</Notice>
        </div>
      </Shell>
    );
  }

  return (
    <Shell shopName={ctx.shopName}>
      <SettingsClient
        shop={shop}
        canEdit={ctx.role === "owner"}
        tenantId={ctx.tenantId}
        timezone={ctx.timezone}
      />
    </Shell>
  );
}
