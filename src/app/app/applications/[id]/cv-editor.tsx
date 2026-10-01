"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveCv } from "@/lib/actions/applications";
import type { FormState } from "@/lib/actions/auth";
import type { CvDocument } from "@/lib/cv";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";

/**
 * Edits the tailored wording of this application's CV: headline, summary,
 * skills and the bullets of each role. Facts (employers, dates, exams,
 * education) are changed on the profile so every future draft gets them.
 */
export function CvEditor({ applicationId, initial }: { applicationId: string; initial: CvDocument }) {
  const [state, action] = useActionState<FormState, FormData>(saveCv, {});
  const [cv, setCv] = useState<CvDocument>(initial);
  const set = <K extends keyof CvDocument>(key: K, value: CvDocument[K]) => setCv((prev) => ({ ...prev, [key]: value }));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={applicationId} />
      <input type="hidden" name="payload" value={JSON.stringify(cv)} />
      <Notice tone="neutral">Edit the wording for this application only. To change facts (dates, employers, exams), update your profile and re-tailor.</Notice>
      <Field label="Headline">
        <input className="input" value={cv.headline} onChange={(e) => set("headline", e.target.value)} />
      </Field>
      <Field label="Summary">
        <textarea className="textarea" rows={5} value={cv.summary} onChange={(e) => set("summary", e.target.value)} />
      </Field>
      <div>
        <p className="label">Skills</p>
        {cv.skills.map((g, i) => (
          <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[160px_1fr]">
            <input className="input" value={g.group} onChange={(e) => set("skills", cv.skills.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)))} />
            <input className="input" value={g.items.join(", ")} onChange={(e) => set("skills", cv.skills.map((x, j) => (j === i ? { ...x, items: e.target.value.split(/[,\n]/).map((s) => s.trimStart()) } : x)))} />
          </div>
        ))}
      </div>
      <div>
        <p className="label">Experience bullets</p>
        {cv.experience.map((e, i) => (
          <div key={i} className="mb-3">
            <p className="mb-1 text-sm font-semibold">
              {e.title} — {e.employer}
            </p>
            <textarea className="textarea" rows={4} value={e.bullets.join("\n")} onChange={(ev) => set("experience", cv.experience.map((x, j) => (j === i ? { ...x, bullets: ev.target.value.split("\n") } : x)))} />
          </div>
        ))}
      </div>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <div className="flex gap-2">
        <SubmitButton pending="Saving…">Save as new version</SubmitButton>
        <Link href={`/app/applications/${applicationId}`} className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold text-graphite hover:bg-cloud">
          Done
        </Link>
      </div>
    </form>
  );
}
