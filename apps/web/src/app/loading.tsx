import { ShellSkeleton } from "@/components/ShellSkeleton";
import { DashboardSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <ShellSkeleton>
      <DashboardSkeleton />
    </ShellSkeleton>
  );
}
