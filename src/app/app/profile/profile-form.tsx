"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveProfile, type ProfileInput } from "@/lib/actions/profile";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Button, Card, CardTitle, Field, Notice } from "@/components/ui";

type Qualification = ProfileInput["qualifications"][number];
type SkillGroup = ProfileInput["skills"][number];
type Experience = ProfileInput["experience"][number];
type Education = ProfileInput["education"][number];
type Section = ProfileInput["extraSections"][number];

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-steel hover:text-red" aria-label="Remove">
      <Trash2 size={16} />
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <Button type="button" variant="secondary" onClick={onClick} className="mt-3">
      <Plus size={15} /> {children}
    </Button>
  );
}

export function ProfileForm({ initial }: { initial: ProfileInput }) {
  const [state, action] = useActionState<FormState, FormData>(saveProfile, {});
  const [p, setP] = useState<ProfileInput>(initial);
  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) => setP((prev) => ({ ...prev, [key]: value }));

  const updateAt = <T,>(key: keyof ProfileInput, index: number, patch: Partial<T>) =>
    setP((prev) => {
      const arr = [...(prev[key] as T[])];
      arr[index] = { ...arr[index], ...patch };
      return { ...prev, [key]: arr };
    });
  const removeAt = (key: keyof ProfileInput, index: number) =>
    setP((prev) => ({ ...prev, [key]: (prev[key] as unknown[]).filter((_, i) => i !== index) }));
  const push = <T,>(key: keyof ProfileInput, item: T) => setP((prev) => ({ ...prev, [key]: [...(prev[key] as T[]), item] }));

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="payload" value={JSON.stringify(p)} />

      <Card>
        <CardTitle>Contact details</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <input className="input" value={p.firstName} onChange={(e) => set("firstName", e.target.value)} required />
          </Field>
          <Field label="Last name">
            <input className="input" value={p.lastName} onChange={(e) => set("lastName", e.target.value)} required />
          </Field>
          <Field label="Phone">
            <input className="input" value={p.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Location" hint="Town and country as it should appear on the CV.">
            <input className="input" value={p.location} onChange={(e) => set("location", e.target.value)} placeholder="London, UK" />
          </Field>
        </div>
        <div className="mt-4">
          <p className="label">Links</p>
          {p.links.map((l, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input className="input sm:max-w-40" placeholder="LinkedIn" value={l.label} onChange={(e) => updateAt<ProfileInput["links"][number]>("links", i, { label: e.target.value })} />
              <input className="input" placeholder="https://" value={l.url} onChange={(e) => updateAt<ProfileInput["links"][number]>("links", i, { url: e.target.value })} />
              <RemoveButton onClick={() => removeAt("links", i)} />
            </div>
          ))}
          <AddButton onClick={() => push("links", { label: "", url: "" })}>Add link</AddButton>
        </div>
      </Card>

      <Card>
        <CardTitle>Profile</CardTitle>
        <Field label="Headline" hint="One line under your name, e.g. “Part-qualified actuary · 6 IFoA exams · pensions and life”.">
          <input className="input" value={p.headline} onChange={(e) => set("headline", e.target.value)} />
        </Field>
        <Field label="Summary" className="mt-4" hint="Three or four sentences. Tailoring rewrites this for each role; the rest of the CV stays factual.">
          <textarea className="textarea" rows={5} value={p.summary} onChange={(e) => set("summary", e.target.value)} />
        </Field>
      </Card>

      <Card>
        <CardTitle>Professional exams and qualifications</CardTitle>
        <p className="mb-3 text-sm text-graphite">Listed near the top of the CV. Passed exams first, then results awaited, then planned.</p>
        <div className="space-y-2">
          {p.qualifications.map((q, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[110px_1fr_140px_150px_auto] sm:items-center">
              <input className="input" placeholder="IFoA" value={q.body} onChange={(e) => updateAt<Qualification>("qualifications", i, { body: e.target.value })} />
              <input className="input" placeholder="CS1 Actuarial Statistics" value={q.name} onChange={(e) => updateAt<Qualification>("qualifications", i, { name: e.target.value })} />
              <select className="select" value={q.status} onChange={(e) => updateAt<Qualification>("qualifications", i, { status: e.target.value as Qualification["status"] })}>
                <option value="PASSED">Passed</option>
                <option value="PENDING">Result awaited</option>
                <option value="PLANNED">Planned</option>
              </select>
              <input className="input" placeholder="Apr 2025" value={q.date} onChange={(e) => updateAt<Qualification>("qualifications", i, { date: e.target.value })} />
              <RemoveButton onClick={() => removeAt("qualifications", i)} />
            </div>
          ))}
        </div>
        <AddButton onClick={() => push<Qualification>("qualifications", { body: p.qualifications[0]?.body ?? "", name: "", status: "PASSED", date: "" })}>Add exam</AddButton>
      </Card>

      <Card>
        <CardTitle>Skills</CardTitle>
        <p className="mb-3 text-sm text-graphite">Grouped, e.g. “Technical: Python, R, Excel, SQL”. One item per line or comma-separated.</p>
        <div className="space-y-3">
          {p.skills.map((g, i) => (
            <div key={i} className="flex gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-[180px_1fr]">
                <input className="input" placeholder="Technical" value={g.group} onChange={(e) => updateAt<SkillGroup>("skills", i, { group: e.target.value })} />
                <input
                  className="input"
                  placeholder="Python, R, Excel, SQL"
                  value={g.items.join(", ")}
                  onChange={(e) => updateAt<SkillGroup>("skills", i, { items: e.target.value.split(/[,\n]/).map((s) => s.trimStart()) })}
                />
              </div>
              <RemoveButton onClick={() => removeAt("skills", i)} />
            </div>
          ))}
        </div>
        <AddButton onClick={() => push<SkillGroup>("skills", { group: "", items: [] })}>Add skill group</AddButton>
      </Card>

      <Card>
        <CardTitle>Experience</CardTitle>
        <p className="mb-3 text-sm text-graphite">Most recent first. Dates as YYYY-MM. Bullets one per line, each starting with what you did and ending with the result.</p>
        <div className="space-y-6">
          {p.experience.map((e, i) => (
            <div key={i} className="rounded-lg border border-mist p-4">
              <div className="mb-3 flex items-start justify-between">
                <p className="text-sm font-semibold text-graphite">Role {i + 1}</p>
                <RemoveButton onClick={() => removeAt("experience", i)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Job title">
                  <input className="input" value={e.title} onChange={(ev) => updateAt<Experience>("experience", i, { title: ev.target.value })} />
                </Field>
                <Field label="Employer">
                  <input className="input" value={e.employer} onChange={(ev) => updateAt<Experience>("experience", i, { employer: ev.target.value })} />
                </Field>
                <Field label="Location">
                  <input className="input" value={e.location} onChange={(ev) => updateAt<Experience>("experience", i, { location: ev.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start">
                    <input className="input" placeholder="2023-09" value={e.start} onChange={(ev) => updateAt<Experience>("experience", i, { start: ev.target.value })} />
                  </Field>
                  <Field label="End">
                    <input className="input" placeholder="2025-03" value={e.end} disabled={e.current} onChange={(ev) => updateAt<Experience>("experience", i, { end: ev.target.value })} />
                  </Field>
                </div>
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={e.current} onChange={(ev) => updateAt<Experience>("experience", i, { current: ev.target.checked })} /> I currently work here
              </label>
              <Field label="Achievements and responsibilities" className="mt-3">
                <textarea className="textarea" rows={5} value={e.bullets.join("\n")} onChange={(ev) => updateAt<Experience>("experience", i, { bullets: ev.target.value.split("\n") })} />
              </Field>
            </div>
          ))}
        </div>
        <AddButton onClick={() => push<Experience>("experience", { title: "", employer: "", location: "", start: "", end: "", current: false, bullets: [] })}>Add role</AddButton>
      </Card>

      <Card>
        <CardTitle>Education</CardTitle>
        <div className="space-y-4">
          {p.education.map((e, i) => (
            <div key={i} className="rounded-lg border border-mist p-4">
              <div className="mb-3 flex items-start justify-between">
                <p className="text-sm font-semibold text-graphite">Qualification {i + 1}</p>
                <RemoveButton onClick={() => removeAt("education", i)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Qualification">
                  <input className="input" placeholder="BSc Actuarial Science" value={e.qualification} onChange={(ev) => updateAt<Education>("education", i, { qualification: ev.target.value })} />
                </Field>
                <Field label="Institution">
                  <input className="input" value={e.institution} onChange={(ev) => updateAt<Education>("education", i, { institution: ev.target.value })} />
                </Field>
                <Field label="Grade">
                  <input className="input" placeholder="First class" value={e.grade} onChange={(ev) => updateAt<Education>("education", i, { grade: ev.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start">
                    <input className="input" placeholder="2018" value={e.start} onChange={(ev) => updateAt<Education>("education", i, { start: ev.target.value })} />
                  </Field>
                  <Field label="End">
                    <input className="input" placeholder="2021" value={e.end} onChange={(ev) => updateAt<Education>("education", i, { end: ev.target.value })} />
                  </Field>
                </div>
              </div>
              <Field label="Notes" className="mt-3" hint="Modules, dissertation, prizes.">
                <input className="input" value={e.notes} onChange={(ev) => updateAt<Education>("education", i, { notes: ev.target.value })} />
              </Field>
            </div>
          ))}
        </div>
        <AddButton onClick={() => push<Education>("education", { institution: "", qualification: "", grade: "", start: "", end: "", notes: "" })}>Add qualification</AddButton>
      </Card>

      <Card>
        <CardTitle>Other sections</CardTitle>
        <p className="mb-3 text-sm text-graphite">Anything else your field expects: memberships, publications, languages, volunteering. Items one per line.</p>
        <div className="space-y-4">
          {p.extraSections.map((s, i) => (
            <div key={i} className="flex gap-2">
              <div className="flex-1 space-y-2">
                <input className="input" placeholder="Section title" value={s.title} onChange={(e) => updateAt<Section>("extraSections", i, { title: e.target.value })} />
                <textarea className="textarea" rows={3} value={s.items.join("\n")} onChange={(e) => updateAt<Section>("extraSections", i, { items: e.target.value.split("\n") })} />
              </div>
              <RemoveButton onClick={() => removeAt("extraSections", i)} />
            </div>
          ))}
        </div>
        <AddButton onClick={() => push<Section>("extraSections", { title: "", items: [] })}>Add section</AddButton>
      </Card>

      <Card>
        <CardTitle>Application details</CardTitle>
        <p className="mb-3 text-sm text-graphite">Used in draft messages and application forms. Never included in AI prompts.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Availability">
            <input className="input" placeholder="Available immediately" value={p.availability} onChange={(e) => set("availability", e.target.value)} />
          </Field>
          <Field label="Notice period">
            <input className="input" placeholder="None" value={p.noticePeriod} onChange={(e) => set("noticePeriod", e.target.value)} />
          </Field>
          <Field label="Salary from (£)" hint="Leave blank for flexible; drafts use the advert's range or a sensible estimate.">
            <input className="input" type="number" min={0} value={p.salaryMin ?? ""} onChange={(e) => set("salaryMin", e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Salary to (£)">
            <input className="input" type="number" min={0} value={p.salaryMax ?? ""} onChange={(e) => set("salaryMax", e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Salary note" className="sm:col-span-2">
            <input className="input" placeholder="Flexible depending on role and study support" value={p.salaryNote} onChange={(e) => set("salaryNote", e.target.value)} />
          </Field>
          <Field label="Right to work" className="sm:col-span-2" hint="What drafts say when an advert asks. e.g. “Full right to work in the UK on a dependant visa; no sponsorship required.”">
            <textarea className="textarea" rows={2} value={p.rightToWork} onChange={(e) => set("rightToWork", e.target.value)} />
          </Field>
          <Field label="Visa expiry" hint="Blank if not applicable.">
            <input className="input" type="date" value={p.visaExpiresAt} onChange={(e) => set("visaExpiresAt", e.target.value)} />
          </Field>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={p.aiTailoring} onChange={(e) => set("aiTailoring", e.target.checked)} />
          <span>
            <span className="font-semibold">AI tailoring</span>
            <br />
            <span className="text-graphite">Send the professional sections above with each job advert to the AI provider to rewrite the summary and reorder skills. Off: drafts are tailored by keyword matching only.</span>
          </span>
        </label>
      </Card>

      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <div className="sticky bottom-0 -mx-5 border-t border-mist bg-paper/95 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
        <SubmitButton pending="Saving…">Save profile</SubmitButton>
      </div>
    </form>
  );
}
