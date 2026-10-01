import { NextResponse } from "next/server";
import { buildPacket, planValues } from "@/lib/apply";
import type { FormField } from "@/lib/apply-runner";

// The browser sends the form's fields; the app says what goes in each.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!secret || given !== secret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json()) as { attemptId: string; fields: FormField[]; pageText?: string };
  const packet = await buildPacket(id, body.attemptId);
  const values = await planValues(packet, body.fields ?? [], body.pageText ?? "");
  return NextResponse.json({ values });
}
