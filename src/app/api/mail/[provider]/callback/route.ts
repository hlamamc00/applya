import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { siteUrl } from "@/lib/mail";
import { completeConnection, isOAuthProvider, readState } from "@/lib/mail-oauth";

// Google / Microsoft send the browser back here with a code; the mailbox is
// saved for the person named in the signed state, who must also be the one
// signed in.
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(request.url);
  const back = (query: string) => NextResponse.redirect(new URL(`/app/settings?${query}`, siteUrl()), 303);
  if (!isOAuthProvider(provider)) return back("mail=unavailable");
  const denied = url.searchParams.get("error");
  if (denied) return back(`mail=denied&detail=${encodeURIComponent(url.searchParams.get("error_description") ?? denied)}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const user = await getCurrentUser();
  const stateUser = state ? readState(state) : null;
  if (!code || !user || !stateUser || stateUser !== user.id) return back("mail=invalid");
  try {
    const email = await completeConnection(provider, user.id, code, `${user.firstName} ${user.lastName}`);
    return back(`mail=connected&email=${encodeURIComponent(email)}`);
  } catch (error) {
    return back(`mail=failed&detail=${encodeURIComponent(error instanceof Error ? error.message : String(error))}`);
  }
}
