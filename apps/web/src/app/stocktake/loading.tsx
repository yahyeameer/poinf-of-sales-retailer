import { ShellSkeleton } from "@/components/ShellSkeleton";
import { ListPageSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <ShellSkeleton>
      <ListPageSkeleton />
    </ShellSkeleton>
  );
}
