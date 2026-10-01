import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { siteUrl } from "@/lib/mail";

export async function POST() {
  await destroySession();
  return NextResponse.redirect(new URL("/", siteUrl()), { status: 303 });
}
