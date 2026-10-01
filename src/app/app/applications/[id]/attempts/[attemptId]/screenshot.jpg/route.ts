import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

// The screenshot the browser took of the employer's form.
export async function GET(_: Request, { params }: { params: Promise<{ id: string; attemptId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });
  const { id, attemptId } = await params;
  const attempt = await db.applicationAttempt.findFirst({ where: { id: attemptId, applicationId: id, application: { userId: user.id } }, select: { screenshot: true } });
  if (!attempt?.screenshot) return new NextResponse("No screenshot", { status: 404 });
  return new NextResponse(Buffer.from(attempt.screenshot), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
}
