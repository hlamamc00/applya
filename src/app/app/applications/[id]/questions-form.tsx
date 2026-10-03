"use client";

import { useActionState } from "react";
import { Globe, Save } from "lucide-react";
import { answerQuestions } from "@/lib/actions/applications";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";

export interface OpenQuestion {
  label: string;
  type: string;
  options: string[];
  context: string;
}

/** The form's questions nothing could answer: answer here and the browser carries on. */
export function QuestionsForm({ applicationId, questions, previewMode }: { applicationId: string; questions: OpenQuestion[]; previewMode: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(answerQuestions, {});
  return (
    <form action={action} className="mt-3 space-y-3 rounded-lg border border-amber/40 bg-amber-soft p-3">
      <input type="hidden" name="id" value={applicationId} />
      <p className="text-sm font-semibold">The form asked {questions.length === 1 ? "a question" : `${questions.length} questions`} your profile doesn&apos;t answer</p>
      <p className="text-xs text-graphite">Answer below and the browser goes back to the form, fills everything in again with your answers and carries on.</p>
      {questions.map((q) => {
        const name = `q:${q.label}`;
        const hint = q.context && q.context !== q.label && q.context.length > q.label.length + 10 ? q.context.slice(0, 220) : "";
        return (
          <Field key={q.label} label={q.label} hint={hint}>
            {q.options.length > 0 && q.type === "checkbox" ? (
              <div className="grid gap-1">
                {q.options.map((o) => (
                  <label key={o} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={name} value={o} /> {o}
                  </label>
                ))}
              </div>
            ) : q.options.length > 0 ? (
              <select className="input" name={name} defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {q.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : /^(number|tel|email|date|url)$/.test(q.type) ? (
              <input className="input" name={name} type={q.type === "number" ? "text" : q.type} />
            ) : (
              <textarea className="input min-h-20" name={name} rows={2} />
            )}
          </Field>
        );
      })}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="remember" defaultChecked /> Remember these answers for other applications
      </label>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <div className="grid gap-2">
        <SubmitButton variant="green" className="w-full" name="then" value={previewMode ? "preview" : "apply"} pending="Saving…">
          <Globe size={15} /> {previewMode ? "Save answers & preview again" : "Save answers & carry on applying"}
        </SubmitButton>
        <SubmitButton variant="secondary" className="w-full" name="then" value="save" pending="Saving…">
          <Save size={15} /> Save answers only
        </SubmitButton>
      </div>
    </form>
  );
}
