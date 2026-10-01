import { NextResponse } from "next/server";
import { scanStep } from "@/lib/jobs/scan";

// One step of a scan (~20 seconds of work). The background function
// (netlify/functions/scan-background.mts) calls this until it reports done.
// From a terminal: curl -X POST -H "authorization: Bearer $CRON_SECRET" https://applya.co.uk/api/scan

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!secret || given !== secret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const url = new URL(request.url);
  const trigger = request.headers.get("x-trigger") === "SCHEDULED" ? "SCHEDULED" : "MANUAL";
  const summary = await scanStep(trigger, { onlyUserId: url.searchParams.get("user") ?? undefined, budgetMs: 20_000 });
  return NextResponse.json(summary);
}
