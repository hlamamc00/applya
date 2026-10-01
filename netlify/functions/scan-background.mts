// Drives a scan to completion. Netlify runs "-background" functions for up
// to 15 minutes and answers the caller with 202 straight away, so this can
// call the app's /api/scan step after step until the run reports done.
// Started by the scheduled function (scan.mts) and by "Scan now" in the app.

const handler = async (request: Request) => {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!secret || given !== secret) return new Response("Unauthorised", { status: 401 });
  // The site's own netlify.app address: it works whatever state the custom domain is in.
  const site = process.env.SITE_NAME ? `https://${process.env.SITE_NAME}.netlify.app` : (process.env.SITE_URL ?? process.env.URL ?? "").replace(/\/$/, "");
  if (!site) return new Response("SITE_URL is not set", { status: 500 });

  const url = new URL(request.url);
  const user = url.searchParams.get("user");
  const trigger = request.headers.get("x-trigger") === "SCHEDULED" ? "SCHEDULED" : "MANUAL";
  const stepUrl = `${site}/api/scan${user ? `?user=${encodeURIComponent(user)}` : ""}`;
  const stop = Date.now() + 14 * 60_000;

  for (let step = 1; Date.now() < stop; step += 1) {
    const res = await fetch(stepUrl, { method: "POST", headers: { authorization: `Bearer ${secret}`, "x-trigger": trigger } });
    const text = await res.text();
    console.log(`[scan] step ${step}: ${res.status} ${text.slice(0, 300)}`);
    if (!res.ok) break;
    let done = true;
    try {
      done = (JSON.parse(text) as { done?: boolean }).done !== false;
    } catch {
      // not JSON: treat as finished
    }
    if (done) break;
  }
  return new Response("", { status: 202 });
};

export default handler;
