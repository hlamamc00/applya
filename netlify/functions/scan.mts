import type { Config } from "@netlify/functions";

// The daily job scan. Netlify runs this on the schedule below (UTC); it hands
// the work to scan-background.mts, which may run for up to 15 minutes.

const handler = async () => {
  const site = (process.env.SITE_URL ?? process.env.URL ?? "").replace(/\/$/, "");
  const secret = process.env.CRON_SECRET;
  if (!site || !secret) {
    console.error("[scan] SITE_URL and CRON_SECRET must be set");
    return;
  }
  const res = await fetch(`${site}/.netlify/functions/scan-background`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "x-trigger": "SCHEDULED" } });
  console.log(`[scan] background scan started: ${res.status}`);
};

export const config: Config = {
  // 06:30 UTC every day, so drafts are waiting first thing in the UK.
  schedule: "30 6 * * *",
};

export default handler;
