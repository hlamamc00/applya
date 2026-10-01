"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { discardImport, importCv } from "@/lib/actions/profile";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Button, Card, CardTitle, Notice } from "@/components/ui";

export function CvUploadForm({ fileName, uploadedAt, pending }: { fileName: string | null; uploadedAt: string | null; pending: { method: string } | null }) {
  const [state, action] = useActionState<FormState, FormData>(importCv, {});
  return (
    <Card className="mb-6">
      <CardTitle>Start from your existing CV</CardTitle>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="block flex-1">
          <span className="label">Upload a CV (PDF, Word or text, up to 5 MB)</span>
          <input className="input file:mr-3 file:rounded file:border-0 file:bg-cloud file:px-3 file:py-1 file:text-sm file:font-semibold" type="file" name="cv" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" required />
        </label>
        <SubmitButton pending="Reading your CV…">
          <Upload size={15} /> Read into my profile
        </SubmitButton>
      </form>
      <p className="hint">The text is read into the fields below for you to check; nothing is saved until you press Save profile. {fileName ? `Last upload: ${fileName}${uploadedAt ? ` on ${new Date(uploadedAt).toLocaleDateString("en-GB")}` : ""}.` : ""}</p>
      {state.error && (
        <div className="mt-3">
          <Notice tone="red">{state.error}</Notice>
        </div>
      )}
      {state.ok && (
        <div className="mt-3">
          <Notice tone="green">{state.ok}</Notice>
        </div>
      )}
      {pending && !state.ok && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Notice tone="amber">The fields below show what was read from your CV ({pending.method === "AI" ? "AI reading" : "section parser"}). Check them and press Save profile, or discard the import.</Notice>
          <form action={discardImport}>
            <Button type="submit" variant="ghost">
              Discard import
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
}
