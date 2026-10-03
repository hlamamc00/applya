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

Upload an existing CV (PDF, Word or text) and it is read into the fields below: with an AI provider configured the model does the reading, otherwise a section parser (`src/lib/cv-import.ts`). Nothing is saved until the person has checked the fields and pressed Save; the extracted text is kept on the profile.

The structured content a CV is built from: contact details and links, a headline and summary, professional exams (passed / result awaited / planned), grouped skills, experience with bullets, education and any extra sections a field needs. Separate fields hold availability, notice period, salary expectations, right-to-work wording and visa expiry; these go into draft messages but are never sent to the AI provider. The sections are JSON on `Profile` (`src/lib/cv.ts`), so a user in another field adds whatever their CV needs without a schema change.

### Job preferences (`/app/preferences`)

Keywords, exclusions, locations, levels and areas of interest, a minimum match score, and three switches: daily scanning, review emails, and automatic approval of drafts (off by default; review a few drafts first).

### Indeed, Glassdoor and LinkedIn

Neither Indeed nor Glassdoor offers a jobs API any more and both refuse server-side readers (HTTP 403), so their adverts arrive through **Google for Jobs** (the JSearch source, `RAPIDAPI_KEY`), which indexes Indeed, Glassdoor, LinkedIn, Totaljobs and CV-Library listings, and through Adzuna. **LinkedIn** has its own source: its public job search as a signed-out visitor sees it (`LINKEDIN`, no key), with the description read from the advert page. Every member's keywords get one search on each aggregator whose key is set (Reed, Adzuna, Google for Jobs, LinkedIn, Jooble, Careerjet), created automatically at the start of each scan (`ensureKeywordSources`). Careers boards found by web search are kept only when they carry adverts for the field. Members see a count of sources; the list itself is for admins.

### One advert per vacancy

The same vacancy appears on several boards, in several feeds of one board, and again when an agency re-posts it. `src/lib/jobs/dedupe.ts` keys adverts by canonical URL and by a fingerprint of title and employer (locations, filler and company suffixes removed); a scan folds a copy into the advert already held, whether open, closed or applied to, so matches and applications stay with one advert and nothing is listed twice. **Admin → Duplicate adverts → Merge duplicates** tidies copies that got in before this.

### Sources and scanning

Sources live in the database (`JobSource`) and are managed under **Admin → Sources & scans**:

| Kind | Needs | Config |
| --- | --- | --- |
| Greenhouse, Lever, Ashby, Workable board | nothing | the employer's board token / slug |
| Job feed (RSS) | nothing | the feed URL; `{page}` in it reads several pages (Madgex boards such as theactuaryjobs.com expose `/jobsrss/?keywords=…`) |
| Reed search (no key) | nothing | search terms, optional place: reed.co.uk's public feed |
| Adzuna search | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` (free at developer.adzuna.com) | search terms, optional place, days back |
| Reed API search | `REED_API_KEY` (free at reed.co.uk/developers) | search terms, optional place, days back |
| Google for Jobs (JSearch) | `RAPIDAPI_KEY` (rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) | search terms, place: LinkedIn, Indeed, Glassdoor, employer sites and more |
| Jooble, Careerjet | `JOOBLE_API_KEY`, `CAREERJET_API_KEY` (free) | search terms, place |

Feeds only carry a summary, so the scanner reads each new advert's own page (its schema.org `JobPosting` where there is one) for the full description, employer, location and salary. The same advert on several boards is kept once.

**Finding sources beyond the list.** Under **Job preferences → Find more sources for me** (and **Admin → Find sources for a field**) `src/lib/jobs/discover.ts` adds a reed.co.uk search per keyword straight away and, when `ANTHROPIC_API_KEY` (Claude with web search) or `BRAVE_SEARCH_API_KEY` is set, searches the web for employers in the field whose careers sites run on Greenhouse / Lever / Ashby / Workable and for specialist job boards with feeds. Every candidate is tried first; only ones that return adverts are saved.

**How a scan runs.** `src/lib/jobs/scan.ts` works in steps so it fits serverless time limits: read sources → read advert pages → score every open advert for each user (`src/lib/jobs/matching.ts`: title keywords, location, level signals, areas, study support) → prepare drafts for the strongest matches (up to 12 per person per scan, from a score of 70). `POST /api/scan` does ~20 seconds of work and records progress on `ScanRun`; on Netlify `netlify/functions/scan-background.mts` calls it until done (up to 15 minutes), started by the daily `scan.mts` (06:30 UTC) or by **Scan now**. From a terminal `npm run scan` runs a whole scan.

The seed adds The Actuary Jobs (the IFoA's board) and reed.co.uk searches for "actuarial" / "actuary", which need no keys, plus Adzuna and Reed API searches that do, and one public Greenhouse board.

### Tailoring and AI providers

`src/lib/tailor.ts` adapts the profile to one advert. With an AI provider configured and the user's AI tailoring switch on, the model rewrites the headline and summary, reorders skills and each role's bullets, and drafts a 150–220 word cover message; facts are checked back against the profile so nothing invented survives. Without a key (or with the switch off) a keyword pass does the reordering and fills in a plain-worded message. Each `CvVersion` records which method produced it.

`src/lib/llm.ts` is the one place that talks to a model. Every provider with a key is queued, free tiers first and Anthropic last; a call goes to the first provider that isn't resting, and one that answers with a rate limit, exhausted quota, an outage or unusable output is rested (5 min for a rate limit, an hour for quota, 6 h for a rejected key) while the next takes over. `AiProviderState` keeps the rests and counts; Admin shows them. `AI_PROVIDER` sets the order.

| Provider | Key | Cost |
| --- | --- | --- |
| Groq | `GROQ_API_KEY` (console.groq.com) | free tier |
| Google Gemini | `GEMINI_API_KEY` (aistudio.google.com) | free tier |
| OpenRouter | `OPENROUTER_API_KEY` (openrouter.ai) | free models (`:free`) |
| Cloudflare Workers AI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` | free daily allowance |
| Anthropic Claude | `ANTHROPIC_API_KEY` | paid |

`GROQ_MODEL`, `GEMINI_MODEL`, `OPENROUTER_MODEL`, `CLOUDFLARE_AI_MODEL` and `ANTHROPIC_MODEL` override the defaults. Web discovery of sources uses Brave Search (`BRAVE_SEARCH_API_KEY`, free tier) or Claude's web search.

### Applications and approval (`/app/applications`)

An application holds the job, its CV versions, the cover message, private notes and a history of events. Statuses: Draft → Ready to review → Approved → Submitted → Interview / Offer / Rejected, or Withdrawn.

- **Approve** records the exact CV version on screen (`approvedCvId`); the button carries the version id, so a version saved in another tab can't be approved unseen.
- Editing the CV or the message after approval moves the application back to review.
- Approving can submit straight away. When the advert names an application email (`Job.applyEmail`, found while reading the advert), **Approve & send to …** emails the message and the approved CV from the person's own mailbox. When it points at a form, **Approve & apply on their site** sends a browser to fill it in. **Approve only** just records the approval; the same actions are offered afterwards, with a **Preview the filled-in form first** that stops before pressing Submit and shows a screenshot.
- **Questions the profile can't answer** come back to the portal: the application shows each one (with the form's own options where it offered any), the applicant answers, and the browser goes back and carries on. Answers are kept on the application and, by default, remembered on the profile (`Profile.answers`) so the next form that asks the same thing is answered automatically; a remembered answer beats every rule.
- Every submission gets a copy to the applicant: the message, the CV that went with it and (for forms) a screenshot of the final screen and what the browser did.
- Statuses **Applying…** (a browser is working) and **Needs you** (it stopped: an account or CAPTCHA was required, the form asked for something the profile doesn't hold — reported as *Additional information required: …* — or validation failed). The screenshot and the page it reached are shown on the application, and the applicant is emailed.
- With **Submit automatically** on under preferences (and auto-approve), the daily scan does all of this without a review.

### Applying on employer sites (`src/lib/apply-runner.ts`)

A headless Chromium (`puppeteer-core` + `@sparticuz/chromium`, in the `apply-background` Netlify function) opens the advert, follows Apply links (preferring "No thanks, continue to apply" / "apply as guest" routes on job boards such as The Actuary Jobs, waiting out timed redirects and "please wait" curtains), and stops at sign-in walls and CAPTCHAs. On the form it reads every control with its label, options and surrounding text, then plans answers: rules for the usual fields (name, email, phone, LinkedIn, location, cover letter, salary, notice, availability, right to work, consent) and the AI for the rest, told never to guess. The CV PDF is attached to any file input. Required questions nothing could answer stop the run *before* submit. Multi-step forms are followed page by page. Only the site's own confirmation ("thank you for your application", "application received"…) marks the application Submitted; validation messages, a missing confirmation or a sign-in wall mark it Needs you with the reason. Search boxes, job-alert and newsletter forms are ignored. Before the advert itself, the browser tries the same vacancy on the employer's or agency's own site (`src/lib/jobs/alternatives.ts`: a Brave search restricted to the company's own domain, confirmed as a live advert for that title), where no job-board account is needed; a route that ends at a sign-in wall, a CAPTCHA or without a form hands over to the next. When a login is saved for the site, the browser signs in before applying — a signed-in applicant usually gets the quick form and no CAPTCHA (The Actuary Jobs puts reCAPTCHA on its guest form only). Sites that insist on an account (Reed, for one) are signed into with the logins saved under **Account → Job site logins** (`PortalAccount`, password encrypted); a site that applies with the CV saved on the account and offers no upload stops and says so. Copies and notices to the applicant come from Applya's own address (`SMTP_*`, `MAIL_FROM`), never from their mailbox, which is only used to write to employers. The browser talks to the app through `/api/apply/<id>/packet|plan|result` (bearer `CRON_SECRET`). In development set `APPLY_CHROMIUM_PATH` to a local Chromium and the same runner is driven in-process.

### Sending from the person's own email (`/app/settings`)

Under **Account → Your mailbox** a person connects their own mailbox, two ways:

- **Connect Gmail / Connect Outlook** (OAuth, `src/lib/mail-oauth.ts`): Applya asks only for permission to send (`gmail.send`; `Mail.Send` + `User.Read` + `offline_access`), never to read the inbox. Tokens are stored encrypted and refreshed automatically; Gmail sends through the Gmail API, Outlook through Microsoft Graph with `saveToSentItems`. Needs `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and/or `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`; set-up steps are at the top of `mail-oauth.ts`. Until Google verifies the app, add each Gmail user as a test user on the OAuth consent screen.
- **Another provider (SMTP)**: Gmail, Outlook, Yahoo and iCloud presets with an app password, or any SMTP details. The login is checked before it is saved and the password is stored encrypted (AES-256-GCM, key derived from `AUTH_SECRET`; `src/lib/crypto.ts`).

Approved applications are then sent from that address (`src/lib/user-mail.ts`), so they appear in the person's Sent folder and replies come straight back to them. The application records the recipient and the provider's message id.
- The PDF (`/app/applications/<id>/cv.pdf`, `src/lib/cv-pdf.ts`) is always named `Firstname_Lastname_CV.pdf`, whatever the job. Layout: name and contact line, headline, profile, professional qualifications (passed first), skills, experience (reverse chronological), education, extra sections.

## Configuration

All settings are environment variables; `.env.example` lists them.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Neon's pooled URL) |
| `DATABASE_URL_UNPOOLED` | Neon's direct URL, used for schema pushes on deploy (optional; derived from `DATABASE_URL` otherwise) |
| `AUTH_SECRET` | Signs the login cookie (32+ random characters) |
| `SITE_URL` | Absolute site URL, for links in emails and the scheduled scan |
| `CRON_SECRET` | Protects `/api/scan` and `/api/apply/*` (the Netlify functions call them with it) |
| `APPLY_CHROMIUM_PATH` | Development only: a Chromium binary for applying on sites locally (Netlify ships its own) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_FIRST_NAME`, `SEED_ADMIN_LAST_NAME` | The first admin account, created by the seed if it doesn't exist |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`+`CLOUDFLARE_AI_TOKEN`, `ANTHROPIC_API_KEY`, `AI_PROVIDER`, `*_MODEL` | AI tailoring and CV reading (optional; all keys set are queued as backups for each other) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Applya's own address: password resets, review emails, copies of submitted applications and "needs you" notices (optional; nothing is sent without them) |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `REED_API_KEY`, `RAPIDAPI_KEY`, `JOOBLE_API_KEY`, `CAREERJET_API_KEY` | The keyed aggregator sources (optional) |
| `BRAVE_SEARCH_API_KEY` | Web discovery of sources without an Anthropic key (optional) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | "Connect Gmail" / "Connect Outlook" (optional; SMTP works without) |

## Deploying to Netlify with Neon

1. **Neon:** create a project and database. Copy both the pooled and the direct connection strings.
2. **Netlify:** create a site from this repository. `netlify.toml` sets the build (`npm run build:netlify`, webpack) and the Next.js runtime plugin. Add the environment variables above under Site configuration → Environment variables. Set `SITE_URL=https://applya.co.uk`.
3. Production builds run `prisma db push` against the direct connection first, so a merged schema change reaches the database before the pages are built; a change that would lose data stops the build and has to be applied by hand. Deploy previews don't push.
4. Seed once from your machine with the production `.env`: `npm run db:seed`. (It only adds what's missing.)
5. The scheduled scan (`netlify/functions/scan.mts`) and the background worker it starts (`scan-background.mts`) are deployed with the site; Netlify shows them under Functions. They need `SITE_URL` and `CRON_SECRET`.

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
src/lib/cv-import.ts        reading an uploaded CV into the profile
src/lib/user-mail.ts        sending from the person's own mailbox
src/lib/jobs/               source connectors, scoring, discovery, the stepped scan
src/lib/applications.ts     drafts, versions, approvals
src/lib/actions/            Server Actions behind every form
```
