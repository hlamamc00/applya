# Applya

A private career workspace at [applya.co.uk](https://applya.co.uk): it scans job sources for roles that fit each user's preferences, tailors their CV and a cover message to each strong match, and holds every application for review and approval before anything is sent. Built first for a UK actuarial job search (entry level to part qualified), designed so any user can sign up, describe their own field and run the same process.

**Stack:** Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS v4 · Prisma 6 · Postgres (Neon) · Netlify (site + scheduled function) · pdf-lib · Anthropic SDK (optional AI tailoring) · Nodemailer (optional email)

## Getting started

1. Create a Postgres database (Neon's free tier is fine) and copy its connection string.
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `AUTH_SECRET` and the `SEED_ADMIN_*` values. Everything else is optional.
3. Install, create the tables, seed the admin account and default sources, and start:

```bash
npm run setup
npm run dev
```

Sign in at http://localhost:3000 with the seeded admin email and password, then fill in **Profile & CV** (experience and education are blank until you add them) and check **Job preferences**. Press **Scan now** under Matches, or run `npm run scan` from a terminal.

## How it works

### Accounts

Email and password accounts (bcrypt hashes, a signed HttpOnly session cookie that lasts seven days, rate-limited sign-in and password reset). Every profile, preference, match, CV version and application belongs to one user and every query is scoped to the signed-in user. The `ADMIN` role adds the admin area (sources, scan history, users); the seeded account is an admin and can promote others.

### Profile & CV (`/app/profile`)

The structured content a CV is built from: contact details and links, a headline and summary, professional exams (passed / result awaited / planned), grouped skills, experience with bullets, education and any extra sections a field needs. Separate fields hold availability, notice period, salary expectations, right-to-work wording and visa expiry; these go into draft messages but are never sent to the AI provider. The sections are JSON on `Profile` (`src/lib/cv.ts`), so a user in another field adds whatever their CV needs without a schema change.

### Job preferences (`/app/preferences`)

Keywords, exclusions, locations, levels and areas of interest, a minimum match score, and three switches: daily scanning, review emails, and automatic approval of drafts (off by default; review a few drafts first).

### Sources and scanning

Sources live in the database (`JobSource`) and are managed under **Admin → Sources & scans**:

| Kind | Needs | Config |
| --- | --- | --- |
| Greenhouse, Lever, Ashby, Workable board | nothing | the employer's board token / slug |
| Adzuna search | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` (free at developer.adzuna.com) | search terms, optional place, days back |
| Reed search | `REED_API_KEY` (free at reed.co.uk/developers) | search terms, optional place, days back |

`src/lib/jobs/scan.ts` reads every enabled source, stores adverts (`Job`, deduplicated per source), marks ones that disappeared as closed, then scores every open advert for each user against their preferences (`src/lib/jobs/matching.ts`: title keywords, location, level signals, areas, study support). Matches at or above the user's threshold appear under **Matches**; from 70 up a draft application is prepared automatically. The scan runs daily from `netlify/functions/scan.mts` (06:30 UTC), which calls `POST /api/scan` with `CRON_SECRET`; a user's **Scan now** re-scores everything for them so changed preferences take effect at once.

The seed adds Adzuna and Reed searches for "actuarial" / "actuary" / "trainee actuary" (they need the keys) and one public Greenhouse board so a first scan has something to read. Add employers' own boards as you find them: the token is in the careers page URL (`job-boards.greenhouse.io/<token>`, `jobs.lever.co/<slug>`, `jobs.ashbyhq.com/<name>`, `apply.workable.com/<subdomain>`).

### Tailoring

`src/lib/tailor.ts` adapts the profile to one advert. With `ANTHROPIC_API_KEY` set and the user's AI tailoring switch on, Claude rewrites the headline and summary, reorders skills and each role's bullets, and drafts a 150–220 word cover message; facts are checked back against the profile so nothing invented survives. Without a key (or with the switch off) a keyword pass does the reordering and fills in a plain-worded message. Each `CvVersion` records which method produced it.

### Applications and approval (`/app/applications`)

An application holds the job, its CV versions, the cover message, private notes and a history of events. Statuses: Draft → Ready to review → Approved → Submitted → Interview / Offer / Rejected, or Withdrawn.

- **Approve** records the exact CV version on screen (`approvedCvId`); the button carries the version id, so a version saved in another tab can't be approved unseen.
- Editing the CV or the message after approval moves the application back to review.
- **Approved** and **Submitted** are separate: approving never sends anything. Apply on the employer's site with the downloaded PDF and the message, then **Mark as submitted**. Automatic submission is not implemented; the status model and the approval trail are ready for it.
- The PDF (`/app/applications/<id>/cv.pdf`, `src/lib/cv-pdf.ts`) is always named `Firstname_Lastname_CV.pdf`, whatever the job. Layout: name and contact line, headline, profile, professional qualifications (passed first), skills, experience (reverse chronological), education, extra sections.

## Configuration

All settings are environment variables; `.env.example` lists them.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Neon's pooled URL) |
| `DATABASE_URL_UNPOOLED` | Neon's direct URL, used for schema pushes on deploy (optional; derived from `DATABASE_URL` otherwise) |
| `AUTH_SECRET` | Signs the login cookie (32+ random characters) |
| `SITE_URL` | Absolute site URL, for links in emails and the scheduled scan |
| `CRON_SECRET` | Protects `/api/scan` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_FIRST_NAME`, `SEED_ADMIN_LAST_NAME` | The first admin account, created by the seed if it doesn't exist |
| `ANTHROPIC_API_KEY`, `TAILOR_MODEL` | AI tailoring (optional; keyword tailoring without it) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Password-reset and review emails (optional; nothing is sent without them) |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `REED_API_KEY` | The aggregator sources (optional) |

## Deploying to Netlify with Neon

1. **Neon:** create a project and database. Copy both the pooled and the direct connection strings.
2. **Netlify:** create a site from this repository. `netlify.toml` sets the build (`npm run build:netlify`, webpack) and the Next.js runtime plugin. Add the environment variables above under Site configuration → Environment variables. Set `SITE_URL=https://applya.co.uk`.
3. Production builds run `prisma db push` against the direct connection first, so a merged schema change reaches the database before the pages are built; a change that would lose data stops the build and has to be applied by hand. Deploy previews don't push.
4. Seed once from your machine with the production `.env`: `npm run db:seed`. (It only adds what's missing.)
5. The scheduled scan (`netlify/functions/scan.mts`) is deployed with the site; Netlify shows it under Functions → Scheduled. It needs `SITE_URL` and `CRON_SECRET`.

### Connecting applya.co.uk

In Netlify, Domain management → Add a domain → `applya.co.uk`, then at the registrar either:

- point the nameservers at Netlify DNS (the four `dns1–4.p0X.nsone.net` names Netlify shows), or
- keep the current DNS and add an `A` record for `applya.co.uk` → `75.2.60.5` and a `CNAME` for `www` → `<site-name>.netlify.app`.

Netlify issues the TLS certificate once the records resolve. Set the primary domain to `applya.co.uk` so `www` redirects.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Next.js |
| `npm run build:netlify` | the webpack build Netlify runs |
| `npm run lint` / `npm run typecheck` | ESLint, `tsc --noEmit` |
| `npm run db:push` / `npm run db:seed` / `npm run db:studio` | Prisma |
| `npm run scan` | one scan from the terminal, using `.env` |

## Project layout

```
prisma/schema.prisma        data model (User, Profile, Preference, JobSource, Job, Match, Application, CvVersion, ApplicationEvent, ScanRun)
prisma/seed.ts              first admin, starter actuarial profile and preferences, default sources
netlify/functions/scan.mts  daily scheduled scan
src/app/                    pages: sign-in, register, reset; /app (overview, matches, applications, profile, preferences, account); /admin
src/lib/auth.ts             sessions and passwords
src/lib/cv.ts               CV document shape; cv-pdf.ts renders it
src/lib/tailor.ts           AI and keyword tailoring
src/lib/jobs/               source connectors, scoring, the scan
src/lib/applications.ts     drafts, versions, approvals
src/lib/actions/            Server Actions behind every form
```
