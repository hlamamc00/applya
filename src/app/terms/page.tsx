import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="1 October 2026">
      <h2>1. Operator and agreement</h2>
      <p>
        Applya is operated by H&amp;J BUSINESS SOLUTIONS LTD. Contact support@hnjuk.co.uk for support, complaints and account questions. These terms
        govern your use of the Applya career workspace; read them with our Privacy Policy. By creating an account or continuing to use Applya after
        these terms have been made available, you agree to them. These terms do not remove any mandatory consumer or data-protection rights.
      </p>
      <h2>2. What Applya provides</h2>
      <p>
        Applya helps you maintain a career profile, build CVs, discover opportunities, prepare application drafts and review applications. Optional
        functions include AI tailoring, daily searches and review notifications. Discovery does not cover every employer, job board or vacancy;
        adverts can change or close. Applya is not the employer or recruitment decision-maker and does not guarantee an interview, offer, eligibility,
        visa sponsorship or other outcome.
      </p>
      <h2>3. Your account and information</h2>
      <p>
        Keep credentials secure, provide accurate account details and tell us if you suspect unauthorised access. You are responsible for the accuracy
        of your qualifications, employment history, skills, work authorisation and other application information. Do not invent credentials or upload
        material you have no right to use.
      </p>
      <h2>4. Review and approval</h2>
      <p>
        Before approving an application, review the actual CV, message and role requirements. AI checks are not a substitute for your review. Approval
        is recorded against the exact CV version you reviewed; a later edit needs a new approval. Approval records your decision; where an employer
        uses its own website form, you complete that form yourself and mark the application as submitted. Once sent, an application cannot reliably be
        recalled.
      </p>
      <h2>5. AI, third parties and availability</h2>
      <p>
        AI-generated CVs and messages may contain errors, omissions or inappropriate wording; you decide whether to use them. Employer sites and job
        boards operate independently and may impose their own terms. We aim to keep the service available but cannot promise uninterrupted access.
        Keep your own copies of important CVs and confirmations.
      </p>
      <h2>6. Acceptable use</h2>
      <p>
        Do not use Applya for spam, harassment, unlawful discrimination, impersonation, fraud or misleading applications, or to access another
        user&apos;s account or documents. We may restrict or suspend access where reasonably necessary to investigate misuse or protect the service.
      </p>
      <h2>7. Your content and the platform</h2>
      <p>
        You retain your rights in the CVs, profile information and other material you supply. You give us permission to store, process, format and
        transmit that material only as needed to provide the service. Applya&apos;s branding and platform software are not transferred to you.
      </p>
      <h2>8. Charges, ending use and data</h2>
      <p>
        The current portal does not collect a subscription fee. If paid features are introduced, their price and conditions will be agreed separately
        beforehand. To request account closure or deletion, email support@hnjuk.co.uk. Closing an account cannot withdraw applications already sent.
      </p>
      <h2>9. Responsibility and your legal rights</h2>
      <p>
        We are responsible for providing our service with the care required by applicable law. You remain responsible for reviewing information and
        deciding which jobs to apply for. Nothing in these terms excludes liability that cannot lawfully be excluded; your statutory consumer rights
        remain unaffected.
      </p>
      <h2>10. Changes and complaints</h2>
      <p>
        We may revise these terms to reflect changes in the service or legal requirements and will bring material changes to your attention. Send
        complaints to support@hnjuk.co.uk; nothing in these terms prevents you from seeking help from a regulator or a court with jurisdiction.
      </p>
    </LegalShell>
  );
}
