// Shared constants and the allowed values of the string "enums" in the schema.

export const BRAND = {
  name: "Applya",
  tagline: "Your career workspace",
  operator: "H&J BUSINESS SOLUTIONS LTD",
  supportEmail: "support@hnjuk.co.uk",
  domain: "applya.co.uk",
} as const;

export const APPLICATION_STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED", "SUBMITTED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "Ready to review",
  APPROVED: "Approved",
  SUBMITTED: "Submitted",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export const MATCH_STATUSES = ["NEW", "SHORTLISTED", "DISMISSED", "DRAFTED"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const JOB_LEVELS = ["ENTRY", "GRADUATE", "PART_QUALIFIED", "MID", "SENIOR"] as const;
export type JobLevel = (typeof JOB_LEVELS)[number];

export const JOB_LEVEL_LABELS: Record<JobLevel, string> = {
  ENTRY: "Entry level",
  GRADUATE: "Graduate / trainee",
  PART_QUALIFIED: "Part qualified",
  MID: "Mid level",
  SENIOR: "Senior",
};

export const SOURCE_KINDS = ["GREENHOUSE", "LEVER", "ASHBY", "WORKABLE", "ADZUNA", "REED"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  GREENHOUSE: "Greenhouse board",
  LEVER: "Lever board",
  ASHBY: "Ashby board",
  WORKABLE: "Workable board",
  ADZUNA: "Adzuna search",
  REED: "Reed search",
};

export const QUALIFICATION_STATUSES = ["PASSED", "PENDING", "PLANNED"] as const;
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}
