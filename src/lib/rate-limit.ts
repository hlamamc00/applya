import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { db } from "./db";

// Counts repeated attempts at an action (signing in, password emails) per
// visitor or per email address, in the database so the count is shared by
// every serverless instance. Keys hold a keyed hash of the IP or email, never
// the value itself.

function keyFor(bucket: string, id: string) {
  const digest = createHmac("sha256", process.env.AUTH_SECRET ?? "").update(id.trim().toLowerCase()).digest("hex");
  return `${bucket}:${digest.slice(0, 32)}`;
}

/** The visitor's IP as Netlify saw the connection. */
export async function clientIp() {
  const h = await headers();
  return h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Records one attempt and says whether the count in the current window is still within the limit. */
export async function withinLimit(bucket: string, id: string, limit: number, windowSeconds: number) {
  const key = keyFor(bucket, id);
  const rows = await db.$queryRaw<{ count: number }[]>(Prisma.sql`
    INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}::double precision))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now() THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING "count"`);
  if (Math.random() < 0.02) await db.$executeRaw`DELETE FROM "RateLimit" WHERE "resetAt" < now() - interval '1 day'`;
  return (rows[0]?.count ?? 0) <= limit;
}

export const TOO_MANY_ATTEMPTS = "Too many attempts from here. Please wait a few minutes and try again.";
