import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Whether a browser or email is still working on this application.
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await params;
  const app = await db.application.findFirst({ where: { id, userId: user.id }, select: { status: true, job: { select: { url: true, applyUrl: true } } } });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const attempt = await db.applicationAttempt.findFirst({ where: { applicationId: id, status: { in: ["QUEUED", "RUNNING"] }, startedAt: { gt: new Date(Date.now() - 20 * 60_000) } }, orderBy: { startedAt: "desc" }, select: { kind: true, mode: true } });
  const busy = Boolean(attempt) || app.status === "SUBMITTING";
  const host = new URL(app.job.applyUrl || app.job.url).hostname.replace(/^www\./, "");
  const label = !busy ? "" : attempt?.kind === "EMAIL" ? "Sending the email…" : attempt?.mode === "PREVIEW" ? `Filling in the form on ${host} to show you (not submitting)…` : `Applying on ${host}: opening the advert, filling in the form, attaching the CV…`;
  return NextResponse.json({ busy, label });
}
