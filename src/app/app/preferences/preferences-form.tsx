"use client";

import { useActionState } from "react";
import { findSourcesForMe, savePreferences } from "@/lib/actions/preferences";
import type { FormState } from "@/lib/actions/auth";
import { JOB_LEVEL_LABELS, JOB_LEVELS, SOURCE_KIND_LABELS, type SourceKind } from "@/lib/types";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardTitle, Field, Notice } from "@/components/ui";

interface Initial {
  keywords: string[];
  excludeKeywords: string[];
  locations: string[];
  areas: string[];
  levels: string[];
  minScore: number;
  dailyScan: boolean;
  autoApprove: boolean;
  autoSubmit: boolean;
  reviewEmails: boolean;
}

export function PreferencesForm({ initial, sources }: { initial: Initial; sources: { name: string; kind: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(savePreferences, {});
  const [found, findAction] = useActionState<FormState, FormData>(findSourcesForMe, {});
  return (
    <>
    <form action={action} className="space-y-6">
      <Card>
        <CardTitle>Roles</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Keywords" hint="Words the title or advert should contain. One per line or comma-separated. e.g. actuarial, actuary, trainee actuary">
            <textarea className="textarea" name="keywords" rows={4} defaultValue={initial.keywords.join("\n")} />
          </Field>
          <Field label="Rule out" hint="Adverts containing any of these are skipped. e.g. chief actuary, head of, director">
            <textarea className="textarea" name="excludeKeywords" rows={4} defaultValue={initial.excludeKeywords.join("\n")} />
          </Field>
          <Field label="Areas of interest" hint="Specialisms that score a bonus, e.g. pensions, life, general insurance, pricing, reserving, capital, investment. Leave blank for all areas.">
            <textarea className="textarea" name="areas" rows={3} defaultValue={initial.areas.join("\n")} />
          </Field>
          <Field label="Locations" hint="Countries, regions or cities. “Remote” matches remote roles. e.g. United Kingdom, London, Remote">
            <textarea className="textarea" name="locations" rows={3} defaultValue={initial.locations.join("\n")} />
          </Field>
        </div>
        <div className="mt-4">
          <p className="label">Levels</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {JOB_LEVELS.map((level) => (
              <label key={level} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="levels" value={level} defaultChecked={initial.levels.includes(level)} /> {JOB_LEVEL_LABELS[level]}
              </label>
            ))}
          </div>
          <p className="hint">Nothing ticked means any level.</p>
        </div>
      </Card>

      <Card>
        <CardTitle>Scanning and review</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum match score" hint="0–100. Matches below this are hidden; drafts are prepared from 70 up.">
            <input className="input" type="number" name="minScore" min={0} max={100} defaultValue={initial.minScore} />
          </Field>
        </div>
        <div className="mt-4 space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="dailyScan" className="mt-1" defaultChecked={initial.dailyScan} />
            <span>
              <span className="font-semibold">Daily search</span>
              <br />
              <span className="text-graphite">Scan the sources for me every day and prepare drafts for strong matches.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="reviewEmails" className="mt-1" defaultChecked={initial.reviewEmails} />
            <span>
              <span className="font-semibold">Review emails</span>
              <br />
              <span className="text-graphite">Email me when new drafts are ready to review.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="autoApprove" className="mt-1" defaultChecked={initial.autoApprove} />
            <span>
              <span className="font-semibold">Approve drafts automatically</span>
              <br />
              <span className="text-graphite">
                New drafts for matches scoring 70 or more are approved as soon as they are prepared, so they are ready to send without a review. Leave this off until you have reviewed a few drafts and are happy with how they read.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="autoSubmit" className="mt-1" defaultChecked={initial.autoSubmit} />
            <span>
              <span className="font-semibold">Send automatically-approved drafts straight away</span>
              <br />
              <span className="text-graphite">
                With the switch above on, each auto-approved draft is also sent: by email from your mailbox when the advert gives an address, otherwise by filling in the form on the employer&apos;s site. Anything a site won&apos;t let the browser finish comes back marked &ldquo;Needs you&rdquo;.
              </span>
            </span>
          </label>
        </div>
      </Card>

      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <SubmitButton pending="Saving…">Save preferences</SubmitButton>
    </form>

    <form action={findAction} className="mt-6 space-y-6">
      <Card>
        <CardTitle>Sources being scanned</CardTitle>
        <p className="mb-3 text-sm text-graphite">
          Save your keywords first, then let Applya look further afield: a reed.co.uk search for each keyword straight away, and, when web discovery is on, employers&apos; own careers boards and specialist job boards for your field.
        </p>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Your field" className="flex-1" hint="One phrase, e.g. “actuarial”, “quantity surveying”, “clinical pharmacy”.">
            <input className="input" name="field" placeholder="actuarial" />
          </Field>
          <SubmitButton variant="secondary" pending="Searching… this can take a minute">
            Find more sources for me
          </SubmitButton>
        </div>
        {found.ok && <div className="mb-4"><Notice tone="green">{found.ok}</Notice></div>}
        {found.error && <div className="mb-4"><Notice tone="red">{found.error}</Notice></div>}
        {sources.length === 0 ? (
          <p className="text-sm text-graphite">No sources are set up yet.</p>
        ) : (
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {sources.map((s) => (
              <li key={`${s.kind}-${s.name}`} className="flex justify-between gap-3 border-b border-cloud py-1.5">
                <span>{s.name}</span>
                <span className="text-graphite">{SOURCE_KIND_LABELS[s.kind as SourceKind] ?? s.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </form>
    </>
  );
}
