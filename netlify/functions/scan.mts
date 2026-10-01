import type { Config } from "@netlify/functions";

// The daily job scan. Netlify runs this on the schedule below (UTC) and it
// asks the app to scan, so the scanner itself lives with the rest of the code.

const handler = async () => {
  const site = (process.env.SITE_URL ?? process.env.URL ?? "").replace(/\/$/, "");
  const secret = process.env.CRON_SECRET;
  if (!site || !secret) {
    console.error("[scan] SITE_URL and CRON_SECRET must be set");
    return;
  }
  const res = await fetch(`${site}/api/scan`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  console.log(`[scan] ${res.status}: ${await res.text()}`);
};

export const config: Config = {
  // 06:30 UTC every day, so drafts are waiting first thing in the UK.
  schedule: "30 6 * * *",
};

export default handler;
