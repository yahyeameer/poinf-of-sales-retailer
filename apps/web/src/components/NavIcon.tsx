"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

import type { IconComponent } from "@/components/nav-items";
import { cn } from "@/lib/utils";

/**
 * A nav item's icon, replaced by a spinner while the route it points at is
 * still being fetched.
 *
 * Every screen in this app is server-rendered on demand, so a tap on a slow
 * connection used to do nothing visible until the new page swapped in — staff
 * tapped twice, and the second tap landed on whatever the new page put under
 * their thumb. The spinner is the acknowledgement.
 *
 * This MUST render inside the <Link> it reports on: useLinkStatus reads the
 * pending state from the nearest Link ancestor, and returns a permanent
 * `false` anywhere else, which fails silently rather than loudly.
 */
export function NavIcon({ icon: Icon, className }: { icon: IconComponent; className?: string }) {
  const { pending } = useLinkStatus();

  if (pending) {
    // The label beside it already names the destination, so the spinner is
    // decorative — announcing "loading" here would talk over the navigation
    // the screen reader is already reporting.
    return <Loader2 className={cn(className, "animate-spin")} aria-hidden="true" />;
  }

  return <Icon className={className} />;
}
