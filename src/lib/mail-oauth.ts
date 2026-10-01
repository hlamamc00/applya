import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { siteUrl } from "./mail";
import type { MailAttachment } from "./mail";

// Gmail and Outlook connected with OAuth, so Applya can send from the
// person's own address with only "send mail" permission: no password, no
// reading of their inbox. Tokens are stored encrypted; the refresh token
// keeps the connection alive.
//
// Set-up (once, by the admin):
//   Google: console.cloud.google.com → APIs & Services → enable "Gmail API"
//     → OAuth consent screen (External; add yourself as a test user while
//     unverified) → Credentials → OAuth client ID (Web application) with
//     redirect URI https://applya.co.uk/api/mail/google/callback.
//     Put the client id/secret in GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
//   Microsoft: entra.microsoft.com → App registrations → New (accounts in any
//     org directory and personal accounts) → Redirect URI (Web)
//     https://applya.co.uk/api/mail/microsoft/callback → Certificates &
//     secrets → new client secret. API permissions: Mail.Send, User.Read,
//     offline_access (delegated). MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET.

export type OAuthProvider = "google" | "microsoft";

interface ProviderConfig {
  label: string;
  kind: "GMAIL" | "OUTLOOK";
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  extraAuthParams: Record<string, string>;
}

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  google: {
    label: "Gmail",
    kind: "GMAIL",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.send", "openid", "email"],
    clientId: () => process.env.GOOGLE_CLIENT_ID?.trim(),
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET?.trim(),
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  microsoft: {
    label: "Outlook",
    kind: "OUTLOOK",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "User.Read", "Mail.Send"],
    clientId: () => process.env.MICROSOFT_CLIENT_ID?.trim(),
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET?.trim(),
    extraAuthParams: { response_mode: "query", prompt: "select_account" },
  },
};

export function oauthConfigured(provider: OAuthProvider) {
  const p = PROVIDERS[provider];
  return Boolean(p.clientId() && p.clientSecret());
}

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === "google" || value === "microsoft";
}

const redirectUri = (provider: OAuthProvider) => `${siteUrl()}/api/mail/${provider}/callback`;

// --- state: ties the callback to the signed-in user, for 10 minutes ---------

function sign(payload: string) {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "").update(payload).digest("base64url");
}

export function makeState(userId: string) {
  const payload = `${userId}.${Date.now()}.${randomBytes(8).toString("base64url")}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function readState(state: string): string | null {
  const [encoded, sig] = state.split(".");
  if (!encoded || !sig) return null;
  const payload = Buffer.from(encoded, "base64url").toString();
  const expected = sign(payload);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const [userId, issued] = payload.split(".");
  if (!userId || Date.now() - Number(issued) > 10 * 60_000) return null;
  return userId;
}

/** Where to send the browser to grant access. */
export function authorizationUrl(provider: OAuthProvider, userId: string) {
  const p = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: p.clientId()!,
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: p.scopes.join(" "),
    state: makeState(userId),
    ...p.extraAuthParams,
  });
  return `${p.authUrl}?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(provider: OAuthProvider, params: Record<string, string>): Promise<TokenResponse> {
  const p = PROVIDERS[provider];
  const res = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: p.clientId()!, client_secret: p.clientSecret()!, ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error) throw new Error(data.error_description || data.error || `${res.status} from ${p.label}`);
  return data;
}

/** The address of the account that granted access. */
async function accountEmail(provider: OAuthProvider, tokens: TokenResponse): Promise<{ email: string; id: string }> {
  if (provider === "google" && tokens.id_token) {
    const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) as { email?: string; sub?: string };
    if (payload.email) return { email: payload.email, id: payload.sub ?? payload.email };
  }
  if (provider === "microsoft") {
    const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(20_000) });
    const me = (await res.json()) as { id?: string; mail?: string; userPrincipalName?: string };
    const email = me.mail || me.userPrincipalName;
    if (email) return { email, id: me.id ?? email };
  }
  throw new Error(`Couldn't read the ${PROVIDERS[provider].label} account's address`);
}

/** Finishes the connection after the provider sends the browser back with a code. */
export async function completeConnection(provider: OAuthProvider, userId: string, code: string, fromName: string) {
  const tokens = await tokenRequest(provider, { grant_type: "authorization_code", code, redirect_uri: redirectUri(provider) });
  if (!tokens.refresh_token) throw new Error(`${PROVIDERS[provider].label} didn't return a refresh token; remove Applya from your account's connected apps and try again`);
  const account = await accountEmail(provider, tokens);
  const data = {
    kind: PROVIDERS[provider].kind,
    fromName,
    fromEmail: account.email,
    providerAccountId: account.id,
    accessTokenEnc: encrypt(tokens.access_token),
    refreshTokenEnc: encrypt(tokens.refresh_token),
    tokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    scopes: tokens.scope ?? PROVIDERS[provider].scopes.join(" "),
    verifiedAt: new Date(),
    lastError: null,
    host: null,
    port: null,
    username: null,
    passwordEnc: null,
  };
  await db.mailAccount.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return account.email;
}

/** A valid access token, refreshed when within a minute of expiry. */
async function accessToken(account: { userId: string; kind: string; accessTokenEnc: string | null; refreshTokenEnc: string | null; tokenExpiresAt: Date | null }) {
  const provider: OAuthProvider = account.kind === "GMAIL" ? "google" : "microsoft";
  if (account.accessTokenEnc && account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now() + 60_000) return decrypt(account.accessTokenEnc);
  if (!account.refreshTokenEnc) throw new Error("The mailbox connection has expired; connect it again under Account.");
  const tokens = await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: decrypt(account.refreshTokenEnc), ...(provider === "microsoft" ? { scope: PROVIDERS.microsoft.scopes.join(" ") } : {}) });
  await db.mailAccount.update({
    where: { userId: account.userId },
    data: { accessTokenEnc: encrypt(tokens.access_token), tokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000), ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token) } : {}) },
  });
  return tokens.access_token;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

/** Sends through the Gmail API. Returns Gmail's message id. */
export async function sendViaGmail(account: Parameters<typeof accessToken>[0] & { fromName: string; fromEmail: string }, message: OutgoingMail) {
  const token = await accessToken(account);
  const from = account.fromName ? `${account.fromName} <${account.fromEmail}>` : account.fromEmail;
  const mime = await new MailComposer({ from, to: message.to, subject: message.subject, text: message.text, attachments: message.attachments }).compile().build();
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: mime.toString("base64url") }),
    signal: AbortSignal.timeout(25_000),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Gmail returned ${res.status}`);
  return data.id ?? "";
}

/** Sends through Microsoft Graph; the copy lands in Sent Items. */
export async function sendViaOutlook(account: Parameters<typeof accessToken>[0] & { fromName: string; fromEmail: string }, message: OutgoingMail) {
  const token = await accessToken(account);
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: message.subject,
        body: { contentType: "Text", content: message.text },
        toRecipients: [{ emailAddress: { address: message.to } }],
        attachments: (message.attachments ?? []).map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType ?? "application/octet-stream", contentBytes: a.content.toString("base64") })),
      },
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status !== 202 && !res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? `Outlook returned ${res.status}`);
  }
  return `graph-${Date.now()}`;
}
