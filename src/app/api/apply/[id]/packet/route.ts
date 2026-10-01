import { NextResponse } from "next/server";
import { buildPacket } from "@/lib/apply";

// Everything the browser function needs for one attempt. CRON_SECRET only.
export const dynamic = "force-dynamic";

function authorised(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(secret && given === secret);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await params;
  const attemptId = new URL(request.url).searchParams.get("attempt") ?? "";
  try {
    return NextResponse.json(await buildPacket(id, attemptId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}
