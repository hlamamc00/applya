import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { siteUrl } from "@/lib/mail";
import { authorizationUrl, isOAuthProvider, oauthConfigured } from "@/lib/mail-oauth";

// Sends the signed-in person to Google or Microsoft to grant "send mail".
export async function GET(_: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/?next=/app/settings", siteUrl()), 303);
  if (!isOAuthProvider(provider) || !oauthConfigured(provider)) return NextResponse.redirect(new URL("/app/settings?mail=unavailable", siteUrl()), 303);
  return NextResponse.redirect(authorizationUrl(provider, user.id), 303);
}
