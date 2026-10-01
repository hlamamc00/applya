// JWT helpers that are safe to import from the edge runtime (proxy/middleware).
// No database or Node-only modules here.

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "applya_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type UserRole = "USER" | "ADMIN";

export interface SessionPayload {
  userId: string;
  role: UserRole;
  firstName: string;
}

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters (see .env.example)");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(payload: SessionPayload) {
  return new SignJWT({ role: payload.role, firstName: payload.firstName })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      role: payload.role === "ADMIN" ? "ADMIN" : "USER",
      firstName: typeof payload.firstName === "string" ? payload.firstName : "",
    };
  } catch {
    return null;
  }
}
