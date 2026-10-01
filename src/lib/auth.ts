import "server-only";
import { cache } from "react";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSessionToken, verifySessionToken, type SessionPayload } from "./session-token";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** How long a password-reset link stays valid. */
export const RESET_MINUTES = 60;

export function generateResetToken() {
  return randomBytes(32).toString("base64url");
}

/** Reset tokens are random and long, so a plain hash is enough to store them. */
export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Read and verify the session cookie. Cached per request. */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
});

/** Load the signed-in user from the database, or null. Cached per request. */
export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  return db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, createdAt: true },
  });
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Redirects to the sign-in page (remembering where the user was headed). */
export async function requireUser(nextPath = "/app") {
  const user = await getCurrentUser();
  if (!user) redirect(`/?next=${encodeURIComponent(nextPath)}`);
  return user;
}

export async function requireAdmin() {
  const user = await requireUser("/admin");
  if (user.role !== "ADMIN") redirect("/app");
  return user;
}

/** Only callable from a Server Action or Route Handler (cookie writes). */
export async function createSession(user: { id: string; role: string; firstName: string }) {
  const token = await signSessionToken({ userId: user.id, role: user.role === "ADMIN" ? "ADMIN" : "USER", firstName: user.firstName });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
