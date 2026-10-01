import { NextResponse } from "next/server";
import { runScan } from "@/lib/jobs/scan";

// Called by the scheduled Netlify function (netlify/functions/scan.mts) and
// usable from a terminal: curl -X POST -H "authorization: Bearer $CRON_SECRET" https://applya.co.uk/api/scan

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!secret || given !== secret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const summary = await runScan("SCHEDULED");
  return NextResponse.json(summary);
}
