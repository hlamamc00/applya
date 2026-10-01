import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseCv } from "@/lib/cv";
import { renderCvPdf } from "@/lib/cv-pdf";
import { fileSafeName } from "@/lib/utils";

// The newest CV version of an application as a PDF, named
// Firstname_Lastname_CV.pdf whatever the job, as employers expect.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });
  const { id } = await params;
  const app = await db.application.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!app) return new NextResponse("Not found", { status: 404 });
  const version = await db.cvVersion.findFirst({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" } });
  if (!version) return new NextResponse("No CV yet", { status: 404 });
  const pdf = await renderCvPdf(parseCv(version.content));
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileSafeName(user.firstName, user.lastName)}_CV.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
