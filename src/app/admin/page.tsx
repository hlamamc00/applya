import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sourceReady } from "@/lib/jobs/sources";
import { aiTailoringAvailable, aiTailoringLabel } from "@/lib/tailor";
import { isMailConfigured } from "@/lib/mail";
import { SOURCE_KIND_LABELS, type SourceKind } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { deleteSource, toggleSource } from "@/lib/actions/admin";
import { Badge, Button, Card, CardTitle, PageHeader } from "@/components/ui";
import { SourceForm } from "./source-form";
import { AdminScanButton } from "./scan-button";
import { DiscoverForm } from "./discover-form";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const [sources, runs, jobCount, editing] = await Promise.all([
    db.jobSource.findMany({ orderBy: [{ enabled: "desc" }, { name: "asc" }], include: { _count: { select: { jobs: true } } } }),
    db.scanRun.findMany({ orderBy: { startedAt: "desc" }, take: 15 }),
    db.job.count({ where: { closedAt: null } }),
    edit ? db.jobSource.findUnique({ where: { id: edit } }) : null,
  ]);

  return (
    <>
      <PageHeader eyebrow="Admin" title="Sources and scans" intro={`${jobCount} open adverts in the database.`} action={<AdminScanButton />} />
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <Badge tone={aiTailoringAvailable() ? "green" : "amber"}>{aiTailoringAvailable() ? `AI: ${aiTailoringLabel()}` : "AI off (no GROQ_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY)"}</Badge>
        <Badge tone={isMailConfigured() ? "green" : "amber"}>{isMailConfigured() ? "Email on" : "Email off (no SMTP settings)"}</Badge>
        <Badge tone={sourceReady("ADZUNA") ? "green" : "neutral"}>Adzuna {sourceReady("ADZUNA") ? "keys set" : "keys not set"}</Badge>
        <Badge tone={sourceReady("REED") ? "green" : "neutral"}>Reed API {sourceReady("REED") ? "key set" : "key not set"}</Badge>
        <Badge tone={sourceReady("JSEARCH") ? "green" : "neutral"}>Google for Jobs {sourceReady("JSEARCH") ? "key set" : "key not set"}</Badge>
        <Badge tone={process.env.BRAVE_SEARCH_API_KEY ? "green" : "neutral"}>Web discovery {aiTailoringAvailable() || process.env.BRAVE_SEARCH_API_KEY ? "on" : "off"}</Badge>
        <Badge tone={process.env.CRON_SECRET ? "green" : "amber"}>{process.env.CRON_SECRET ? "Scheduled scan armed" : "CRON_SECRET not set"}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Sources</CardTitle>
            {sources.length === 0 ? (
              <p className="text-sm text-graphite">No sources yet. Add one on the right.</p>
            ) : (
              <ul className="divide-y divide-cloud">
                {sources.map((s) => {
                  const cfg = (s.config ?? {}) as { token?: string; query?: string; where?: string; url?: string };
                  return (
                    <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {s.name} {!s.enabled && <Badge>paused</Badge>}
                        </p>
                        <p className="text-sm text-graphite">
                          {SOURCE_KIND_LABELS[s.kind as SourceKind]} · {cfg.token ?? cfg.url ?? `“${cfg.query}”${cfg.where ? ` in ${cfg.where}` : ""}`} · {s._count.jobs} adverts
                        </p>
                        <p className="text-xs text-steel">
                          {s.lastScanAt ? `Last read ${formatDateTime(s.lastScanAt)}` : "Not read yet"}
                          {s.lastError ? ` · ${s.lastError}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <a href={`/admin?edit=${s.id}`} className="rounded-md border border-mist px-3 py-1.5 text-sm font-semibold hover:bg-cloud">
                          Edit
                        </a>
                        <form action={toggleSource}>
                          <input type="hidden" name="id" value={s.id} />
                          <Button type="submit" variant="ghost">
                            {s.enabled ? "Pause" : "Resume"}
                          </Button>
                        </form>
                        <form action={deleteSource}>
                          <input type="hidden" name="id" value={s.id} />
                          <Button type="submit" variant="danger">
                            Delete
                          </Button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Recent scans</CardTitle>
            {runs.length === 0 ? (
              <p className="text-sm text-graphite">No scans yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-graphite">
                  <tr>
                    <th className="py-1 pr-3">Started</th>
                    <th className="py-1 pr-3">Status</th>
                    <th className="py-1 pr-3">Trigger</th>
                    <th className="py-1 pr-3">Read</th>
                    <th className="py-1 pr-3">New</th>
                    <th className="py-1 pr-3">Matches</th>
                    <th className="py-1 pr-3">Drafts</th>
                    <th className="py-1">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-t border-cloud align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                      <td className="py-1.5 pr-3">{r.status === "RUNNING" ? `running (${r.phase.toLowerCase()})` : r.status.toLowerCase()}</td>
                      <td className="py-1.5 pr-3">{r.trigger.toLowerCase()}</td>
                      <td className="py-1.5 pr-3">{r.jobsFound}</td>
                      <td className="py-1.5 pr-3">{r.jobsNew}</td>
                      <td className="py-1.5 pr-3">{r.matchesNew}</td>
                      <td className="py-1.5 pr-3">{r.draftsNew}</td>
                      <td className="py-1.5 text-xs text-red">{Array.isArray(r.errors) ? (r.errors as string[]).join("; ") : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
        <Card>
          <CardTitle>Find sources for a field</CardTitle>
          <DiscoverForm />
        </Card>
        <Card>
          <CardTitle>{editing ? "Edit source" : "Add a source"}</CardTitle>
          <SourceForm key={editing?.id ?? "new"} source={editing ? { id: editing.id, kind: editing.kind, name: editing.name, enabled: editing.enabled, config: (editing.config ?? {}) as Record<string, string | number | undefined> } : null} />
        </Card>
        </div>
      </div>
    </>
  );
}
