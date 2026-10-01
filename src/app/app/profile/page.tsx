import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cvFromProfile } from "@/lib/cv";
import type { ProfileInput } from "@/lib/actions/profile";
import { Notice, PageHeader } from "@/components/ui";
import { Download } from "lucide-react";
import { fileSafeName } from "@/lib/utils";
import { isProfileUsable } from "@/lib/cv";
import type { ParsedProfile } from "@/lib/cv-import";
import { ProfileForm } from "./profile-form";
import { CvUploadForm } from "./cv-upload-form";

export const metadata: Metadata = { title: "Profile & CV" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requireUser("/app/profile");
  const { welcome } = await searchParams;
  const profile =
    (await db.profile.findUnique({ where: { userId: user.id } })) ?? (await db.profile.create({ data: { userId: user.id } }));
  const cv = cvFromProfile(user, profile);
  // A CV that was just read fills the form instead of the saved profile; Save keeps it.
  const pending = (profile.pendingImport ?? null) as ParsedProfile | null;

  const initial: ProfileInput = {
    firstName: user.firstName,
    lastName: user.lastName,
    headline: cv.headline,
    summary: cv.summary,
    phone: cv.phone,
    contactEmail: profile.contactEmail || user.email,
    location: cv.location,
    links: cv.links,
    qualifications: cv.qualifications,
    skills: cv.skills,
    experience: cv.experience,
    education: cv.education,
    extraSections: cv.extraSections,
    availability: profile.availability,
    noticePeriod: profile.noticePeriod,
    salaryMin: profile.salaryMin,
    salaryMax: profile.salaryMax,
    salaryNote: profile.salaryNote,
    rightToWork: profile.rightToWork,
    visaExpiresAt: profile.visaExpiresAt ? profile.visaExpiresAt.toISOString().slice(0, 10) : "",
    aiTailoring: profile.aiTailoring,
    ...(pending
      ? {
          firstName: pending.firstName || user.firstName,
          lastName: pending.lastName || user.lastName,
          headline: pending.headline || cv.headline,
          summary: pending.summary || cv.summary,
          phone: pending.phone || cv.phone,
          contactEmail: pending.contactEmail || profile.contactEmail || user.email,
          location: pending.location || cv.location,
          links: pending.links.length ? pending.links : cv.links,
          qualifications: pending.qualifications.length ? pending.qualifications : cv.qualifications,
          skills: pending.skills.length ? pending.skills : cv.skills,
          experience: pending.experience.length ? pending.experience : cv.experience,
          education: pending.education.length ? pending.education : cv.education,
          extraSections: pending.extraSections.length ? pending.extraSections : cv.extraSections,
        }
      : {}),
  };

  return (
    <>
      <PageHeader
        eyebrow="Profile & CV"
        title="Your career profile"
        intro="Everything a tailored CV is built from. Keep it complete and current; each application draft adapts it to the role without changing what's here."
        action={
          isProfileUsable(profile) ? (
            <a href="/app/profile/cv.pdf" className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-soft">
              <Download size={15} /> Download {fileSafeName(user.firstName, user.lastName)}_CV.pdf
            </a>
          ) : undefined
        }
      />
      {welcome && (
        <div className="mb-6">
          <Notice tone="green">Welcome to Applya. Fill in your profile first, then set your job preferences, and the scanner will start finding matches.</Notice>
        </div>
      )}
      <CvUploadForm fileName={profile.cvFileName} uploadedAt={profile.cvUploadedAt?.toISOString() ?? null} pending={pending ? { method: pending.method } : null} />
      <ProfileForm key={profile.cvUploadedAt?.toISOString() ?? "saved"} initial={initial} />
    </>
  );
}
