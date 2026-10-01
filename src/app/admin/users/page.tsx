import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { setRole } from "@/lib/actions/admin";
import { formatDate } from "@/lib/utils";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const admin = await requireAdmin();
  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { applications: true, matches: true } }, preferences: { select: { dailyScan: true, autoApprove: true } } },
  });
  return (
    <>
      <PageHeader eyebrow="Admin" title="Users" intro="Each account's profile, matches and applications are private to it; this page shows only counts." />
      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-graphite">
            <tr>
              <th className="py-1 pr-3">Name</th>
              <th className="py-1 pr-3">Email</th>
              <th className="py-1 pr-3">Joined</th>
              <th className="py-1 pr-3">Matches</th>
              <th className="py-1 pr-3">Applications</th>
              <th className="py-1 pr-3">Scanning</th>
              <th className="py-1">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-cloud">
                <td className="py-2 pr-3">
                  {u.firstName} {u.lastName}
                </td>
                <td className="py-2 pr-3">{u.email}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{formatDate(u.createdAt)}</td>
                <td className="py-2 pr-3">{u._count.matches}</td>
                <td className="py-2 pr-3">{u._count.applications}</td>
                <td className="py-2 pr-3">
                  {u.preferences?.dailyScan ? "daily" : "paused"}
                  {u.preferences?.autoApprove ? " · auto-approve" : ""}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={u.role === "ADMIN" ? "navy" : "neutral"}>{u.role.toLowerCase()}</Badge>
                    {u.id !== admin.id && (
                      <form action={setRole}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="role" value={u.role === "ADMIN" ? "USER" : "ADMIN"} />
                        <Button type="submit" variant="ghost" className="px-2 py-1 text-xs">
                          {u.role === "ADMIN" ? "Make user" : "Make admin"}
                        </Button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
