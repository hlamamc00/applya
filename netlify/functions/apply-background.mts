// Applies for one job on the employer's site, in a headless Chromium, for
// up to 15 minutes. Started by the app when an application is approved for
// a site that takes a form. The app supplies everything through its own API
// (the packet), chooses what goes in each field (the plan) and keeps the
// result; this function only drives the browser.

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { runApply, type ApplyPacket, type FormField, type PlannedValue } from "../../src/lib/apply-runner";

const handler = async (request: Request) => {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!secret || given !== secret) return new Response("Unauthorised", { status: 401 });
  const site = process.env.SITE_NAME ? `https://${process.env.SITE_NAME}.netlify.app` : (process.env.SITE_URL ?? process.env.URL ?? "").replace(/\/$/, "");
  const { applicationId, attemptId } = (await request.json().catch(() => ({}))) as { applicationId?: string; attemptId?: string };
  if (!site || !applicationId || !attemptId) return new Response("applicationId and attemptId are required", { status: 400 });

  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${site}/api/apply/${applicationId}/${path}`, { ...init, headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", ...(init.headers ?? {}) } });

  const report = async (body: unknown) => {
    const res = await api("result", { method: "POST", body: JSON.stringify({ attemptId, ...(body as object) }) });
    console.log(`[apply] result stored: ${res.status}`);
  };

  const packetRes = await api(`packet?attempt=${encodeURIComponent(attemptId)}`);
  if (!packetRes.ok) {
    console.error(`[apply] packet ${packetRes.status}`);
    await report({ status: "FAILED", detail: `Couldn't load the application (${packetRes.status}).`, log: [] });
    return new Response("", { status: 202 });
  }
  const packet = (await packetRes.json()) as ApplyPacket;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, "--lang=en-GB"],
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: 1280, height: 1000 },
    });
    const result = await runApply(packet, {
      browser,
      progress: (line) => console.log(`[apply] ${line}`),
      plan: async (fields: FormField[], pageText: string) => {
        const res = await api("plan", { method: "POST", body: JSON.stringify({ attemptId, fields, pageText }) });
        if (!res.ok) throw new Error(`plan ${res.status}`);
        return ((await res.json()) as { values: PlannedValue[] }).values;
      },
    });
    await report(result);
  } catch (error) {
    console.error("[apply] failed", error);
    await report({ status: "FAILED", detail: `The browser couldn't run: ${error instanceof Error ? error.message : String(error)}`, log: [] });
  } finally {
    await browser?.close().catch(() => {});
  }
  return new Response("", { status: 202 });
};

export default handler;
