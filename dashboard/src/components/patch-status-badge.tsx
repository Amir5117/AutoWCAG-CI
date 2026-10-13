import { CircleCheck, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function PatchStatusBadge({ status }: { status: string }) {
  if (status === "merged") {
    return (
      <Badge
        variant="outline"
        className="h-5 rounded-md border-emerald-200 bg-emerald-50 px-1.5 text-[11px] text-emerald-700"
      >
        <CircleCheck aria-hidden="true" />
        Merged to GitHub
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="h-5 rounded-md border-amber-200 bg-amber-50 px-1.5 text-[11px] text-amber-700">
      <Clock aria-hidden="true" />
      Pending Approval
    </Badge>
  );
}
