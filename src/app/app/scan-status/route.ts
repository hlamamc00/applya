import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { scanInProgress } from "@/lib/jobs/scan";

// Whether a scan is running, and which phase it is in.
export const dynamic = "force-dynamic";

const phases: Record<string, string> = { SOURCES: "reading sources", ENRICH: "reading adverts", SCORE: "scoring matches", DRAFTS: "preparing drafts" };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const running = await scanInProgress();
  if (!running) return NextResponse.json({ busy: false, label: "" });
  const found = running.jobsFound ? ` · ${running.jobsFound} adverts read` : "";
  const matches = running.matchesNew ? `, ${running.matchesNew} new matches` : "";
  const drafts = running.draftsNew ? `, ${running.draftsNew} drafts` : "";
  return NextResponse.json({ busy: true, label: `Scanning: ${phases[running.phase] ?? running.phase.toLowerCase()}…${found}${matches}${drafts}` });
}
