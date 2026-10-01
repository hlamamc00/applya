import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cvFromProfile } from "@/lib/cv";
import { renderCvPdf } from "@/lib/cv-pdf";
import { fileSafeName } from "@/lib/utils";

// The profile as it stands, untailored, as Firstname_Lastname_CV.pdf.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });
  const profile = await db.profile.findUnique({ where: { userId: user.id } });
  if (!profile) return new NextResponse("Fill in your profile first", { status: 404 });
  const pdf = await renderCvPdf(cvFromProfile(user, profile));
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileSafeName(user.firstName, user.lastName)}_CV.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
