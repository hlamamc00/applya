import "server-only";
import puppeteer from "puppeteer-core";
import { buildPacket, planValues, recordResult } from "./apply";
import { runApply } from "./apply-runner";

// Development only: drives the same runner with a desktop Chromium
// (APPLY_CHROMIUM_PATH) instead of the Netlify function.

export async function runLocally(applicationId: string, attemptId: string) {
  const executablePath = process.env.APPLY_CHROMIUM_PATH;
  if (!executablePath) {
    await recordResult(attemptId, { status: "FAILED", detail: "Set APPLY_CHROMIUM_PATH to a Chromium binary to apply on sites in development." });
    return;
  }
  const packet = await buildPacket(applicationId, attemptId);
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, "--ignore-certificate-errors"] : [])] });
  try {
    const result = await runApply(packet, { browser, plan: (fields, text) => planValues(packet, fields, text), progress: (l) => console.log(`[apply] ${l}`) });
    await recordResult(attemptId, result);
  } finally {
    await browser.close().catch(() => {});
  }
}
