import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across hot reloads in development so we don't
// open a new connection pool every time a file is saved.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Neon's pooled endpoint is PgBouncer in transaction mode: Prisma needs
 * pgbouncer=true on it or nested writes and transactions fail with
 * "prepared statement already exists".
 */
function databaseUrl() {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw || !/-pooler\./.test(raw) || /pgbouncer=/.test(raw)) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}pgbouncer=true&connect_timeout=15`;
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: databaseUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
