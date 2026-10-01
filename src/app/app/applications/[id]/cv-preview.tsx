import type { CvDocument } from "@/lib/cv";
import { monthLabel } from "@/lib/utils";

const statusLabel = { PASSED: "Passed", PENDING: "Result awaited", PLANNED: "Planned" } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 border-b border-mist pb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-navy">{title}</h3>
      {children}
    </section>
  );
}

/** The CV as it will print, in HTML. */
export function CvPreview({ cv }: { cv: CvDocument }) {
  return (
    <div className="rounded-lg border border-mist bg-paper p-6 text-[14px] leading-relaxed sm:p-8">
      <h2 className="font-serif text-2xl text-navy">{cv.name}</h2>
      {cv.headline && <p className="font-semibold text-green">{cv.headline}</p>}
      <p className="text-xs text-graphite">{[cv.location, cv.phone, cv.email, ...cv.links.map((l) => l.url.replace(/^https?:\/\/(www\.)?/, ""))].filter(Boolean).join("  ·  ")}</p>

      {cv.summary && (
        <Section title="Profile">
          <p>{cv.summary}</p>
        </Section>
      )}
      {cv.qualifications.length > 0 && (
        <Section title="Professional qualifications">
          <ul>
            {cv.qualifications.map((q, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  {q.body ? `${q.body} ` : ""}
                  {q.name}
                </span>
                <span className="text-graphite">{[statusLabel[q.status], q.date].filter(Boolean).join(", ")}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {cv.skills.length > 0 && (
        <Section title="Skills">
          {cv.skills.map((g, i) => (
            <p key={i}>
              {g.group && <strong>{g.group}: </strong>}
              {g.items.join(", ")}
            </p>
          ))}
        </Section>
      )}
      {cv.experience.length > 0 && (
        <Section title="Experience">
          {cv.experience.map((e, i) => (
            <div key={i} className="mb-3">
              <div className="flex justify-between gap-3">
                <strong>{e.title}</strong>
                <span className="text-graphite">{[monthLabel(e.start), e.current ? "Present" : monthLabel(e.end)].filter(Boolean).join(" – ")}</span>
              </div>
              <p className="text-graphite">{[e.employer, e.location].filter(Boolean).join(", ")}</p>
              <ul className="mt-1 list-disc pl-5">
                {e.bullets.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </Section>
      )}
      {cv.education.length > 0 && (
        <Section title="Education">
          {cv.education.map((e, i) => (
            <div key={i} className="mb-2">
              <div className="flex justify-between gap-3">
                <strong>{e.qualification || e.institution}</strong>
                <span className="text-graphite">{[e.start, e.end].filter(Boolean).join(" – ")}</span>
              </div>
              <p className="text-graphite">{[e.qualification ? e.institution : "", e.grade].filter(Boolean).join(" · ")}</p>
              {e.notes && <p>{e.notes}</p>}
            </div>
          ))}
        </Section>
      )}
      {cv.extraSections.map((s, i) => (
        <Section key={i} title={s.title}>
          <ul className="list-disc pl-5">
            {s.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
