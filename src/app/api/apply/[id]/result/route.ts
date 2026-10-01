import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordResult } from "@/lib/apply";

// The browser's report on an attempt.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!secret || given !== secret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json()) as { attemptId: string; status: string; detail: string; finalUrl?: string; log?: string[]; screenshotBase64?: string };
  const attempt = await db.applicationAttempt.findFirst({ where: { id: body.attemptId, applicationId: id } });
  if (!attempt) return NextResponse.json({ error: "No such attempt" }, { status: 404 });
  await recordResult(attempt.id, body);
  return NextResponse.json({ ok: true });
}
