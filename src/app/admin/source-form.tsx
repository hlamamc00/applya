"use client";

import { useActionState, useState } from "react";
import { saveSource } from "@/lib/actions/admin";
import type { FormState } from "@/lib/actions/auth";
import { SOURCE_KIND_LABELS, SOURCE_KINDS } from "@/lib/types";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";

interface SourceInput {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  config: Record<string, string | number | undefined>;
}

const help: Record<string, string> = {
  GREENHOUSE: "The board token from the company's careers URL: job-boards.greenhouse.io/<token> or boards.greenhouse.io/<token>.",
  LEVER: "The company slug from jobs.lever.co/<slug>.",
  ASHBY: "The board name from jobs.ashbyhq.com/<name>.",
  WORKABLE: "The subdomain from apply.workable.com/<subdomain>.",
  RSS: "Any job board's RSS/Atom feed. Madgex boards (e.g. theactuaryjobs.com) have /jobsrss/?keywords=…; add &page={page} to read several pages.",
  REED_RSS: "Searches reed.co.uk by keyword through its public feed. No key needed.",
  LINKEDIN: "Searches LinkedIn's public job listings by keyword, as a signed-out visitor sees them. No key needed.",
  ADZUNA: "Searches Adzuna's UK index for the terms below. Needs ADZUNA_APP_ID and ADZUNA_APP_KEY (free at developer.adzuna.com).",
  REED: "Searches reed.co.uk's API for the terms below. Needs REED_API_KEY (free at reed.co.uk/developers).",
  JSEARCH: "Google for Jobs (LinkedIn, Indeed, Glassdoor, employer sites…) through JSearch on RapidAPI. Needs RAPIDAPI_KEY.",
  JOOBLE: "Searches Jooble UK. Needs JOOBLE_API_KEY (free at jooble.org/api/about).",
  CAREERJET: "Searches Careerjet UK. Needs CAREERJET_API_KEY (free partner id at careerjet.co.uk/partners).",
};

export function SourceForm({ source }: { source: SourceInput | null }) {
  const [state, action] = useActionState<FormState, FormData>(saveSource, {});
  const [kind, setKind] = useState(source?.kind ?? "GREENHOUSE");
  const isBoard = ["GREENHOUSE", "LEVER", "ASHBY", "WORKABLE"].includes(kind);
  const isFeed = kind === "RSS";
  return (
    <form action={action} className="space-y-4">
      {source && <input type="hidden" name="id" value={source.id} />}
      <Field label="Kind">
        <select className="select" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {SOURCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {SOURCE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <span className="hint">{help[kind]}</span>
      </Field>
      <Field label="Name" hint="Shown to users, e.g. the employer's name or “Adzuna: actuarial UK”.">
        <input className="input" name="name" defaultValue={source?.name ?? ""} required />
      </Field>
      {isFeed ? (
        <>
          <Field label="Feed URL">
            <input className="input" name="url" placeholder="https://www.theactuaryjobs.com/jobsrss/?keywords=&page={page}" defaultValue={String(source?.config.url ?? "")} />
          </Field>
          <Field label="Company name" hint="Only if every advert in the feed is from one employer.">
            <input className="input" name="company" defaultValue={String(source?.config.company ?? "")} />
          </Field>
        </>
      ) : isBoard ? (
        <>
          <Field label="Board token / slug">
            <input className="input" name="token" defaultValue={String(source?.config.token ?? "")} />
          </Field>
          <Field label="Company name" hint="If the board doesn't say; defaults to the token.">
            <input className="input" name="company" defaultValue={String(source?.config.company ?? "")} />
          </Field>
        </>
      ) : (
        <>
          <Field label="Search terms">
            <input className="input" name="query" placeholder="actuarial" defaultValue={String(source?.config.query ?? "")} />
          </Field>
          <Field label="Where" hint="Optional: a city or region. Blank searches the whole UK.">
            <input className="input" name="where" placeholder="London" defaultValue={String(source?.config.where ?? "")} />
          </Field>
          <Field label="Days back">
            <input className="input" type="number" name="days" min={1} max={60} defaultValue={String(source?.config.days ?? 7)} />
          </Field>
        </>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" value="on" defaultChecked={source?.enabled ?? true} /> Enabled
        <input type="hidden" name="enabled" value="off" />
      </label>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <div className="flex gap-2">
        <SubmitButton pending="Saving…">{source ? "Save changes" : "Add source"}</SubmitButton>
        {source && (
          <a href="/admin" className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold text-graphite hover:bg-cloud">
            Cancel
          </a>
        )}
      </div>
    </form>
  );
}
