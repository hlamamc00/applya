import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cvFromProfile } from "@/lib/cv";
import type { ProfileInput } from "@/lib/actions/profile";
import { Notice, PageHeader } from "@/components/ui";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile & CV" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requireUser("/app/profile");
  const { welcome } = await searchParams;
  const profile =
    (await db.profile.findUnique({ where: { userId: user.id } })) ?? (await db.profile.create({ data: { userId: user.id } }));
  const cv = cvFromProfile(user, profile);

  const initial: ProfileInput = {
    firstName: user.firstName,
    lastName: user.lastName,
    headline: cv.headline,
    summary: cv.summary,
    phone: cv.phone,
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
  };

  return (
    <>
      <PageHeader
        eyebrow="Profile & CV"
        title="Your career profile"
        intro="Everything a tailored CV is built from. Keep it complete and current; each application draft adapts it to the role without changing what's here."
      />
      {welcome && (
        <div className="mb-6">
          <Notice tone="green">Welcome to Applya. Fill in your profile first, then set your job preferences, and the scanner will start finding matches.</Notice>
        </div>
      )}
      <ProfileForm initial={initial} />
    </>
  );
}
