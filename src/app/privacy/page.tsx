import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="1 October 2026">
      <h2>1. Who is responsible for your information</h2>
      <p>
        Applya is operated by H&amp;J BUSINESS SOLUTIONS LTD, which is the controller of the personal information described in this notice. Contact
        support@hnjuk.co.uk for privacy questions, support, account closure or requests to exercise your rights. This notice covers applya.co.uk and the
        Applya career workspace.
      </p>
      <h2>2. Information we process</h2>
      <p>
        You provide account details, including your name and email address, and a password stored in a hashed form. Your career profile may contain
        contact details, location, employment history, education, skills, qualifications, exam progress, salary preferences, availability and
        work-authorisation information. We store generated CVs, job preferences and application drafts.
      </p>
      <p>
        We also record application decisions, the versions approved, timestamps and history. Applications and their history can contain earlier
        versions of your documents and messages. Public job sources supply adverts, employer names, locations and application links. Infrastructure
        services may process IP addresses, session identifiers, browser or device information and diagnostic logs to operate and protect the service.
      </p>
      <p>
        Only include information needed for job applications. Avoid adding identity-document scans, bank details, medical information or other highly
        sensitive information. Ensure you have permission before including another person&apos;s details, such as a referee.
      </p>
      <h2>3. Purposes and legal bases</h2>
      <p>
        We process account information, profiles, CVs, searches, drafts and approval records to provide the service you request and fulfil our agreement
        with you. Optional AI tailoring uses the professional information described below when you enable that feature; we rely on your consent for
        this optional sharing, and you can turn it off in Profile &amp; CV. Daily searches and review emails support the job-search service; you can
        pause them in Job preferences. Password-reset messages are necessary account communications.
      </p>
      <p>
        We rely on legitimate interests to protect accounts, prevent abuse and duplicate submissions, troubleshoot faults and keep an appropriate record
        of activity. We do not sell your personal information or use your CV to target advertising.
      </p>
      <h2>4. CV tailoring and AI services</h2>
      <p>
        When AI tailoring is enabled, Applya sends your professional summary, skills, experience, education and qualifications, together with the job
        advert, to the configured AI provider (Anthropic). Each draft records the method used. Dedicated contact, salary and immigration fields are
        excluded from AI prompts, but information you put inside a summary or other professional text may still be included. AI output can be
        inaccurate; you must review generated content before using it. Applya does not make hiring decisions or guarantee job eligibility.
      </p>
      <h2>5. Who receives information</h2>
      <p>
        Service providers support hosting (Netlify), the database (Neon), email delivery and optional AI functions. Access is limited according to the
        service being performed. Job searches may disclose search terms and locations to public job sources; Applya does not send your CV to those
        sources to discover jobs. When you apply to an employer, they receive what you choose to send them. Information may also be disclosed where
        required by law, to protect rights and security, or in connection with a lawful business transfer subject to applicable safeguards.
      </p>
      <h2>6. International processing and security</h2>
      <p>
        Our infrastructure, email and AI providers may process information outside the UK, subject to applicable transfer protections. We use
        authenticated accounts, ownership checks and encrypted connections. No online system can guarantee complete security; report suspected
        unauthorised access promptly.
      </p>
      <h2>7. Retention and deletion</h2>
      <p>
        Profiles, generated documents and application records are retained to keep your workspace and history available while your account remains
        in use. You can request account closure or deletion of particular information at support@hnjuk.co.uk; we may verify your identity and explain
        any limits. Session access expires after seven days without renewal and password-reset links after one hour.
      </p>
      <h2>8. Your choices and rights</h2>
      <p>
        You may request access, correction, deletion, restriction or, where applicable, a portable copy of your information, object to processing based
        on legitimate interests and withdraw consent for consent-based processing. Send requests or complaints to support@hnjuk.co.uk; we normally
        respond within one month. You may also complain to the UK Information Commissioner&apos;s Office at ico.org.uk.
      </p>
      <h2>9. Cookies and changes to this notice</h2>
      <p>
        Applya uses necessary sign-in, session and security cookies only. We may update this notice as the service changes; the date above identifies
        this version, and material changes will be brought to your attention through the service.
      </p>
    </LegalShell>
  );
}
