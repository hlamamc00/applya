import { Badge } from "./ui";
import { APPLICATION_STATUS_LABELS, type ApplicationStatus } from "@/lib/types";

const tone: Record<ApplicationStatus, "neutral" | "green" | "amber" | "red" | "blue" | "navy"> = {
  DRAFT: "neutral",
  IN_REVIEW: "amber",
  APPROVED: "blue",
  SUBMITTED: "green",
  INTERVIEW: "green",
  OFFER: "navy",
  REJECTED: "red",
  WITHDRAWN: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  const s = status as ApplicationStatus;
  return <Badge tone={tone[s] ?? "neutral"}>{APPLICATION_STATUS_LABELS[s] ?? status}</Badge>;
}

export function ScoreBadge({ score }: { score: number }) {
  return <Badge tone={score >= 70 ? "green" : score >= 50 ? "blue" : "neutral"}>{score}% match</Badge>;
}
