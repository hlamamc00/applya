// Creates the first admin account (from SEED_ADMIN_* in .env) with a starter
// profile and preferences for a part-qualified UK actuarial search, and the
// default job sources. Safe to run again: it only adds what's missing.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const SOURCES: { kind: string; name: string; config: Record<string, string | number> }[] = [
  // Aggregators cover most UK actuarial adverts; they need the keys in .env.
  { kind: "ADZUNA", name: "Adzuna: actuarial (UK)", config: { query: "actuarial", days: 7 } },
  { kind: "ADZUNA", name: "Adzuna: actuary (UK)", config: { query: "actuary", days: 7 } },
  { kind: "REED", name: "Reed: actuarial (UK)", config: { query: "actuarial", days: 7 } },
  { kind: "REED", name: "Reed: trainee actuary (UK)", config: { query: "trainee actuary", days: 7 } },
  // A public ATS board that needs no key, so a first scan has something to read.
  { kind: "GREENHOUSE", name: "Wise", config: { token: "wise", company: "Wise" } },
];

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@applya.co.uk").trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const firstName = process.env.SEED_ADMIN_FIRST_NAME ?? "Applya";
  const lastName = process.env.SEED_ADMIN_LAST_NAME ?? "Admin";

  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    user = await db.user.create({
      data: {
        email,
        firstName,
        lastName,
        role: "ADMIN",
        passwordHash: await bcrypt.hash(password, 10),
        profile: {
          create: {
            headline: "Part-qualified actuary · IFoA exams in progress",
            summary: "",
            location: "United Kingdom",
            qualifications: [
              { body: "IFoA", name: "CS1 Actuarial Statistics", status: "PASSED", date: "" },
              { body: "IFoA", name: "CM1 Actuarial Mathematics", status: "PASSED", date: "" },
              { body: "IFoA", name: "CB1 Business Finance", status: "PASSED", date: "" },
              { body: "IFoA", name: "CB2 Business Economics", status: "PASSED", date: "" },
              { body: "IFoA", name: "CP1 Actuarial Practice", status: "PASSED", date: "" },
              { body: "IFoA", name: "CM2 Financial Engineering and Loss Reserving", status: "PASSED", date: "" },
              { body: "IFoA", name: "CP3 Communications Practice", status: "PENDING", date: "" },
              { body: "IFoA", name: "CS2 Risk Modelling and Survival Analysis", status: "PENDING", date: "" },
            ],
            skills: [
              { group: "Technical", items: ["Excel", "Python", "R", "SQL", "VBA"] },
              { group: "Actuarial", items: ["Pricing", "Reserving", "Valuation", "Financial reporting", "Modelling"] },
            ],
            availability: "Available immediately",
            noticePeriod: "None",
            salaryNote: "Flexible; guided by the advertised range and the role",
            rightToWork: "Full right to work in the UK on a dependant visa (valid to 14 March 2027); no sponsorship required.",
            visaExpiresAt: new Date("2027-03-14"),
          },
        },
        preferences: {
          create: {
            keywords: ["actuarial", "actuary", "actuarial analyst", "trainee actuary", "actuarial trainee", "actuarial student"],
            excludeKeywords: ["head of", "director", "chief actuary", "partner", "principal"],
            locations: ["United Kingdom", "Remote"],
            levels: ["ENTRY", "GRADUATE", "PART_QUALIFIED", "MID"],
            areas: ["pensions", "life", "general insurance", "pricing", "reserving", "capital", "investment", "financial reporting"],
            minScore: 40,
            dailyScan: true,
            autoApprove: false,
            reviewEmails: true,
          },
        },
      },
    });
    console.log(`Created admin ${email} (password from SEED_ADMIN_PASSWORD). Fill in the profile's experience and education before the first draft.`);
  } else {
    console.log(`Admin ${email} already exists.`);
  }

  for (const s of SOURCES) {
    await db.jobSource.upsert({ where: { kind_name: { kind: s.kind, name: s.name } }, create: s, update: {} });
  }
  console.log(`${SOURCES.length} default sources in place.`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
