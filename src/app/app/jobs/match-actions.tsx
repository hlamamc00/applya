import { draftForJob, setMatchStatus } from "@/lib/actions/applications";
import { SubmitButton } from "@/components/submit-button";

/** Shortlist / dismiss / prepare a draft, under a match. */
export function MatchActions({ jobId, status, applicationId }: { jobId: string; status: string; applicationId?: string | null }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {applicationId ? (
        <a href={`/app/applications/${applicationId}`} className="inline-flex items-center rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-soft">
          Open application
        </a>
      ) : (
        <form action={draftForJob}>
          <input type="hidden" name="jobId" value={jobId} />
          <SubmitButton pending="Preparing draft…">Prepare tailored draft</SubmitButton>
        </form>
      )}
      {status !== "SHORTLISTED" && status !== "DRAFTED" && (
        <form action={setMatchStatus}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="status" value="SHORTLISTED" />
          <SubmitButton variant="secondary">Shortlist</SubmitButton>
        </form>
      )}
      {status !== "DISMISSED" && status !== "DRAFTED" && (
        <form action={setMatchStatus}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="status" value="DISMISSED" />
          <SubmitButton variant="ghost">Dismiss</SubmitButton>
        </form>
      )}
      {status === "DISMISSED" && (
        <form action={setMatchStatus}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="status" value="NEW" />
          <SubmitButton variant="ghost">Restore</SubmitButton>
        </form>
      )}
    </div>
  );
}
