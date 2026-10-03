// Fills in a job application form in a headless browser.
//
// Given a "packet" (who is applying, with what CV and message, to which
// advert), the runner opens the advert, follows its Apply link to the form,
// reads the form's fields, asks the app which value goes in each (plan),
// fills them in, uploads the CV and presses Submit. It reports what happened
// with a screenshot. It stops and hands back to the person when a site wants
// an account, shows a CAPTCHA challenge, or rejects the form.
//
// Pure of any database or framework: the function (apply-background.mts)
// supplies the browser and the two callbacks, and the same code runs locally
// against a desktop Chromium for testing.

import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, ElementHandle, Page, Target } from "puppeteer-core";

export interface ApplyPacket {
  applicationId: string;
  attemptId: string;
  /** Fill everything in and stop before submitting. */
  dryRun: boolean;
  job: { url: string; applyUrl?: string | null; title: string; company: string; /** The same vacancy on the employer's or agency's own site, best first. */ alternatives?: string[] };
  applicant: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    website: string;
    summary: string;
    /** Current or most recent job title. */
    headline: string;
    coverMessage: string;
    facts: { availability: string; noticePeriod: string; rightToWork: string; salary: string; visaExpiresAt: string };
    cvFileName: string;
    cvPdfBase64: string;
  };
  /** Job-site accounts the browser may sign in with when a site insists. */
  logins?: { host: string; username: string; password: string }[];
  /** Answers the applicant has given to form questions before: used whenever a question matches. */
  answers?: { question: string; answer: string }[];
}

export interface FormField {
  id: number;
  tag: "input" | "select" | "textarea";
  type: string;
  name: string;
  label: string;
  placeholder: string;
  required: boolean;
  /** Radio groups, checkbox groups and selects. */
  options: { value: string; label: string }[];
  /** True for a React-style combobox that needs typing then Enter. */
  combobox: boolean;
  /** What the field already holds (a saved profile fills some in). */
  value: string;
  /** Text around the field, for questions whose label is elsewhere. */
  context: string;
}

export interface PlannedValue {
  id: number;
  action: "type" | "select" | "check" | "file" | "skip";
  /** The text to type, the option to choose (by label or value), or the options to tick. */
  value?: string | string[];
}

export interface ApplyReport {
  status: "SUBMITTED" | "PREVIEWED" | "NEEDS_YOU" | "FAILED";
  detail: string;
  finalUrl: string;
  log: string[];
  screenshotBase64?: string;
  /** Required questions the form asked that nothing could answer, for the applicant to answer in the portal. */
  questions?: OpenQuestion[];
}

export interface OpenQuestion {
  label: string;
  type: string;
  options: string[];
  context: string;
}

export interface RunnerDeps {
  browser: Browser;
  plan: (fields: FormField[], pageText: string) => Promise<PlannedValue[]>;
  /** Called as things happen, for progress; the final report is returned. */
  progress?: (line: string) => void;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const NAV_TIMEOUT = 25_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs in the page: collects the visible form controls, tagging each with a data attribute so it can be found again. */
const EXTRACT_FIELDS = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && (r.width > 0 || r.height > 0 || el.type === "file"); };
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\\s+/g, " ").trim();
  const labelFor = (el) => {
    const parts = [];
    if (el.labels && el.labels.length) parts.push(...[...el.labels].map(text));
    const aria = el.getAttribute("aria-label"); if (aria) parts.push(aria);
    const by = el.getAttribute("aria-labelledby"); if (by) parts.push(...by.split(/\\s+/).map((id) => text(document.getElementById(id))));
    const wrap = el.closest("label"); if (wrap) parts.push(text(wrap));
    if (!parts.join("").trim()) {
      // The nearest heading-ish text before the control.
      let node = el; let hops = 0;
      while (node && hops < 4) {
        let prev = node.previousElementSibling;
        while (prev && hops < 6) { const t = text(prev); if (t && t.length < 200) { parts.push(t); break; } prev = prev.previousElementSibling; hops++; }
        if (parts.length) break;
        node = node.parentElement; hops++;
      }
    }
    return [...new Set(parts.filter(Boolean))].join(" | ").slice(0, 240);
  };
  // A radio/checkbox caption: its label, else the short text right after (or before) it.
  const optionLabel = (el) => {
    const parts = [];
    if (el.labels && el.labels.length) parts.push(...[...el.labels].map(text));
    const aria = el.getAttribute("aria-label"); if (aria) parts.push(aria);
    const wrap = el.closest("label"); if (wrap) parts.push(text(wrap));
    const own = parts.filter(Boolean).join(" | ").trim();
    if (own) return own.slice(0, 160);
    // Broken for= attributes are common: look beside the control, then beside its cell.
    for (const base of [el, el.parentElement, el.parentElement && el.parentElement.parentElement]) {
      if (!base || base === document.body) break;
      if (base !== el && base.querySelectorAll("input, select, textarea").length > 1) break;
      for (const dir of ["nextSibling", "previousSibling"]) {
        let node = base[dir]; let hops = 0;
        while (node && hops < 4) {
          const t = node.nodeType === 3 ? (node.textContent || "").replace(/\\s+/g, " ").trim() : (node.nodeType === 1 && !/^(INPUT|SELECT|TEXTAREA|BR)$/.test(node.tagName) && !node.querySelector("input, select, textarea") ? text(node) : "");
          if (t) { if (t.length <= 120) return t; break; }
          node = node[dir]; hops++;
        }
      }
    }
    return "";
  };
  const context = (el) => { const box = el.closest("fieldset, .field, .form-group, [class*='question'], [class*='field'], li, div"); return box ? text(box).slice(0, 300) : ""; };
  // Site furniture is not the application: search boxes, job-alert and
  // newsletter sign-ups, anything in the header, nav, footer or a sidebar.
  const furniture = (el) => {
    if (el.closest("header, nav, footer, [role='search'], [role='navigation'], [role='banner'], [role='contentinfo'], [data-applya-ignore]")) return true;
    const form = el.closest("form");
    const formSig = form ? [form.id, form.className, form.getAttribute("action") || "", form.getAttribute("name") || "", form.getAttribute("aria-label") || ""].join(" ") : "";
    if (/search|job-?alert|jobalert|newsletter|subscribe|sign-?up-?alert/i.test(formSig)) return true;
    const box = el.closest("aside, [class*='alert'], [class*='newsletter'], [class*='subscribe'], [id*='alert'], [id*='newsletter']");
    if (box && !box.querySelector("input[type='file'], textarea")) return true;
    return /^e\\.g\\. /i.test(el.placeholder || "") && !el.closest("form")?.querySelector("input[type='file'], textarea");
  };
  // A file input is often hidden behind a styled button, so it counts while
  // its surroundings are shown; one inside a closed pop-up does not.
  const shownAround = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const s = getComputedStyle(node);
      if (s.display === "none" || s.visibility === "hidden") return false;
      node = node.parentElement;
    }
    return true;
  };
  const controls = [...document.querySelectorAll("input, select, textarea")].filter((el) => !["hidden", "submit", "button", "reset", "image"].includes(el.type) && !el.disabled && !el.readOnly && (visible(el) || (el.type === "file" && shownAround(el))) && !furniture(el));
  const out = []; const groups = new Map(); let n = 0;
  for (const el of controls) {
    if (el.closest("[data-applya-ignore]")) continue;
    const type = (el.type || el.tagName.toLowerCase());
    if ((type === "radio" || type === "checkbox") && el.name) {
      const key = type + ":" + el.name;
      let g = groups.get(key);
      if (!g) { g = { id: n, tag: "input", type, name: el.name, label: "", placeholder: "", required: false, options: [], combobox: false, value: "", context: context(el) }; groups.set(key, g); out.push(g); n++; }
      const optLabel = optionLabel(el) || labelFor(el) || el.value;
      el.setAttribute("data-applya", String(g.id) + ":" + g.options.length);
      g.options.push({ value: el.value, label: optLabel });
      if (el.checked) g.value = optLabel;
      g.required = g.required || el.required || !!el.closest("[aria-required='true'], .required");
      // The question is whatever labels the group, not the option.
      const fs = el.closest("fieldset"); const legend = fs ? text(fs.querySelector("legend")) : "";
      g.label = legend || g.context.split(optLabel)[0].trim().slice(0, 200) || g.label;
      continue;
    }
    el.setAttribute("data-applya", String(n));
    const options = el.tagName === "SELECT" ? [...el.options].map((o) => ({ value: o.value, label: text(o) })).filter((o) => o.value !== "") : [];
    const combobox = el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list" || !!el.closest("[class*='select__'], [class*='Select'], [role='combobox']");
    const current = el.tagName === "SELECT" ? (el.selectedIndex >= 0 && el.options[el.selectedIndex].value !== "" ? text(el.options[el.selectedIndex]) : "") : type === "file" || type === "password" ? "" : String(el.value || "");
    out.push({ id: n, tag: el.tagName.toLowerCase(), type, name: el.name || "", label: labelFor(el), placeholder: el.placeholder || "", required: el.required || el.getAttribute("aria-required") === "true" || /\\*/.test(labelFor(el)), options, combobox, value: current, context: context(el) });
    n++;
  }
  return out;
})()`;

async function pageText(page: Page) {
  return page.evaluate(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 6000)).catch(() => "");
}

async function screenshot(page: Page) {
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: true, captureBeyondViewport: true });
    return Buffer.from(buf).toString("base64");
  } catch {
    return undefined;
  }
}

/** Something that reads like an application form: a file upload or an email box with a submit button. */
function looksLikeForm(fields: FormField[]) {
  if (looksLikeLogin(fields)) return false;
  const hasFile = fields.some((f) => f.type === "file");
  const hasEmail = fields.some((f) => f.type === "email" || /e-?mail/i.test(f.label));
  const hasName = fields.some((f) => /\b(first|last|full|your) ?name|surname|forename/i.test(f.label));
  const hasMore = fields.some((f) => f.tag === "textarea" || f.type === "tel" || /phone|cover|message|letter/i.test(f.label));
  return hasFile || (hasEmail && hasName && hasMore && fields.length >= 3);
}

/** Does a stored login belong to the site this page is on? */
function loginFor(page: Page, logins: ApplyPacket["logins"]) {
  const host = new URL(page.url()).hostname.toLowerCase();
  return (logins ?? []).find((l) => {
    const h = l.host.toLowerCase().replace(/^www\./, "");
    return host === h || host.endsWith(`.${h}`);
  });
}

/** Signs in on an account wall with a stored login. True when the wall went away. */
async function signIn(page: Page, fields: FormField[], login: { host: string; username: string; password: string }, log: string[]) {
  const user = fields.find((f) => f.type === "email") ?? fields.find((f) => /e-?mail|user ?name|login|account/i.test(`${f.label} ${f.name} ${f.placeholder}`) && f.type === "text") ?? fields.find((f) => f.type === "text");
  const pass = fields.find((f) => f.type === "password");
  if (!user || !pass) return false;
  log.push(`Signing in to ${login.host} as ${login.username}`);
  const type = async (f: FormField, value: string) => {
    const h = await page.$(`[data-applya="${f.id}"]`);
    if (!h) return;
    await h.click({ count: 3 }).catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await h.type(value, { delay: 10 });
  };
  await type(user, login.username);
  // Some sites ask for the email first and the password on the next screen.
  if (!(await page.$(`[data-applya="${pass.id}"]`).then((h) => h?.isVisible()).catch(() => false))) {
    const go = await findButton(page, "next") ?? await findButton(page, "submit");
    if (go) {
      const nav = page.waitForNavigation({ timeout: 8000, waitUntil: "domcontentloaded" }).catch(() => null);
      await go.click().catch(() => {});
      await nav;
      await sleep(1500);
      const again = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
      const p2 = again.find((f) => f.type === "password");
      if (!p2) return false;
      await type(p2, login.password);
    }
  } else {
    await type(pass, login.password);
  }
  await tickCaptchaBox(page, log);
  const button = (await findButton(page, "submit")) ?? (await findButton(page, "next"));
  const nav = page.waitForNavigation({ timeout: 15_000, waitUntil: "domcontentloaded" }).catch(() => null);
  if (button) await button.click().catch(() => button.evaluate((e) => e.click()));
  else await page.keyboard.press("Enter").catch(() => {});
  await nav;
  await settle(page);
  const after = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
  if (looksLikeLogin(after) || (await hasCaptchaChallenge(page))) {
    log.push(`Signing in to ${login.host} didn't work`);
    return false;
  }
  log.push(`Signed in to ${login.host}`);
  return true;
}

/** A sign-in wall: a password box and no way to apply without one. */
function looksLikeLogin(fields: FormField[]) {
  return fields.some((f) => f.type === "password") && !fields.some((f) => f.type === "file");
}

/** Clears a cookie banner that would otherwise sit over the form. */
async function dismissCookieBanner(page: Page) {
  const clicked = await page.evaluate(`(() => {
    const els = [...document.querySelectorAll("button, a[role='button'], [role='button']")];
    const text = (el) => (el.textContent || "").replace(/\\s+/g, " ").trim();
    const hit = els.find((el) => /^(i accept|accept( all)?( cookies| & close| and close)?|allow all( cookies)?|i agree|agree( and (close|continue))?|yes,? i agree|got it|ok(ay)?|accept and continue|agree to all)$/i.test(text(el)) && el.offsetParent !== null);
    if (hit) { hit.click(); return true; }
    return false;
  })()`).catch(() => false);
  if (clicked) await sleep(800);
}

/**
 * Job boards with saved profiles (Reed's apply pop-up, say) show the CV on
 * file with an "Update CV" / "Upload a new CV" control that reveals the file
 * input. Press it so our tailored CV goes in instead of the saved one.
 */
async function revealCvUpload(page: Page, log: string[]) {
  const clicked = await page.evaluate(`(() => {
    const text = (el) => (el.innerText || el.value || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
    // Anything that acts as a button, whatever it is made of: a styled span
    // or div with a pointer cursor counts, as long as it is the innermost one.
    const els = [...document.querySelectorAll("button, a, label, input[type='button'], input[type='submit'], [role='button'], [role='link'], [role='tab'], span, div, p")].filter((el) => {
      if (/^(BUTTON|A|LABEL|INPUT)$/.test(el.tagName) || el.getAttribute("role")) return true;
      return getComputedStyle(el).cursor === "pointer" && !el.querySelector("button, a, input, [role='button']");
    });
    // "Update" beside the CV on record: the file name is somewhere in the
    // same pop-up (or the same block of the page), not necessarily next door.
    const nearCvFile = (el) => {
      const box = el.closest("dialog, [role='dialog'], [aria-modal='true'], form, section, article, main") || document.body;
      // No word boundary after the extension: text runs together ("CV.pdfUpdate").
      return /\\.(pdf|docx?|rtf)/i.test(box.textContent || "") || /\\b(cv|resume)\\b/i.test((el.closest("div, li, tr, p") || el).textContent || "");
    };
    const score = (el) => {
      const t = text(el);
      if (!t || t.length > 60 || el.offsetParent === null) return 0;
      if (/^(update|upload|replace|change|add|use)( a| my| your)?( new| different| another)?( cv| resume|résumé)/.test(t) || /^(upload|update) (cv|resume)/.test(t) || /upload (a )?(new )?(cv|resume)/.test(t)) return 3;
      // Just "Update" / "Replace" beside the file on record ("Edit" is usually something else).
      if (/^(update|upload)$/.test(t) && nearCvFile(el)) return 2;
      if (/^(replace|change)$/.test(t) && nearCvFile(el)) return 1;
      return 0;
    };
    const hit = els.map((el) => ({ el, s: score(el) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]?.el;
    if (hit && hit.offsetParent !== null) { hit.click(); return (hit.innerText || hit.textContent || "").trim(); }
    return "";
  })()`).catch(() => "");
  if (clicked) {
    log.push(`Pressed "${clicked}" to upload the CV`);
    await sleep(1500);
    return true;
  }
  return false;
}

/** A short inventory of a page's clickable things, inputs, frames and shadow roots, for the log when nothing fits. */
async function describePage(page: Page) {
  return page
    .evaluate(`(() => {
      const text = (el) => (el.innerText || el.textContent || el.value || "").replace(/\\s+/g, " ").trim().slice(0, 40);
      const shown = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";
      const inDialog = (el) => Boolean(el.closest("dialog, [role='dialog'], [aria-modal='true']"));
      const pointer = (el) => getComputedStyle(el).cursor === "pointer" && !el.querySelector("button, a, input");
      const clickable = [...document.querySelectorAll("button, a, [role='button'], [role='link'], label, input[type='file'], input[type='submit'], input[type='button'], span, div, p")]
        .filter((el) => shown(el) && (/^(BUTTON|A|LABEL|INPUT)$/.test(el.tagName) || el.getAttribute("role") || pointer(el)))
        .sort((a, b) => Number(inDialog(b)) - Number(inDialog(a)))
        .map((el) => (inDialog(el) ? "*" : "") + el.tagName.toLowerCase() + ":" + text(el)).filter((s) => s.length > 3);
      const inputs = [...document.querySelectorAll("input, select, textarea")].map((el) => el.tagName.toLowerCase() + "/" + (el.type || "") + "/" + (el.name || el.id || "") + (shown(el) ? "" : "(hidden)"));
      const frames = [...document.querySelectorAll("iframe")].map((f) => f.src.slice(0, 80));
      const shadows = [...document.querySelectorAll("*")].filter((el) => el.shadowRoot).map((el) => el.tagName.toLowerCase());
      const dialogs = [...document.querySelectorAll("dialog, [role='dialog'], [aria-modal='true']")].map((d) => d.tagName.toLowerCase() + ":" + text(d));
      return "dialogs=" + JSON.stringify(dialogs.slice(0, 5)) + " clickable=" + JSON.stringify(clickable.slice(0, 60)) + " inputs=" + JSON.stringify(inputs.slice(0, 30)) + " iframes=" + JSON.stringify(frames.slice(0, 10)) + " shadow=" + JSON.stringify(shadows.slice(0, 10));
    })()`)
    .then((s) => String(s).slice(0, 3000))
    .catch((e) => `unavailable: ${e instanceof Error ? e.message : String(e)}`);
}

/** Waits (up to 45s) while a site is still processing an upload and keeps its Submit button disabled. */
async function waitForUploads(page: Page, log: string[]) {
  for (let i = 0; i < 30; i += 1) {
    const busy = await page
      .evaluate(`(() => {
        const text = (el) => (el.innerText || el.value || "").replace(/\\s+/g, " ").trim().toLowerCase();
        const processing = /\\b(cv|resume|file|upload)[^.]{0,20}(processing|uploading|checking|scanning)|(processing|uploading)[^.]{0,20}(cv|resume|file)/i.test(document.body.innerText || "");
        const buttons = [...document.querySelectorAll("button, input[type=submit]")].filter((el) => /submit|apply|send|continue|next|finish/.test(text(el)) && el.offsetParent !== null);
        const disabledOnly = buttons.length > 0 && buttons.every((el) => el.disabled || el.getAttribute("aria-disabled") === "true");
        return processing || disabledOnly;
      })()`)
      .catch(() => false);
    if (!busy) return;
    if (i === 0) log.push("Waiting for the site to finish processing the upload");
    await sleep(1500);
  }
}

/** Ticks a reCAPTCHA "I'm not a robot" box; a challenge afterwards is still a stop. */
async function tickCaptchaBox(page: Page, log: string[]) {
  for (const frame of page.frames()) {
    if (!/recaptcha\/api2\/anchor|recaptcha\/enterprise\/anchor/.test(frame.url())) continue;
    const box = await frame.$("#recaptcha-anchor").catch(() => null);
    if (!box) continue;
    await box.click().catch(() => {});
    await sleep(2500);
    log.push("Ticked \"I'm not a robot\"");
    return;
  }
}

async function hasCaptchaChallenge(page: Page) {
  return page
    .evaluate(() => {
      const frames = [...document.querySelectorAll("iframe")].filter((f) => /hcaptcha|turnstile|recaptcha\/api2\/bframe|challenges\.cloudflare/i.test(f.src));
      return frames.some((f) => { const r = f.getBoundingClientRect(); return r.width > 50 && r.height > 50; });
    })
    .catch(() => false);
}

/** Finds the control that leads to the form and clicks it; returns the page that results (a popup or the same page). */
async function followApplyLink(page: Page, browser: Browser, log: string[], seen: Set<string>): Promise<Page | null> {
  await dismissCookieBanner(page);
  // A string script rather than a function: bundlers can wrap named inner
  // functions with helpers (__name) that don't exist inside the page.
  const candidate = await page.evaluateHandle(`(() => {
    const text = (el) => {
      const copy = el.cloneNode(true);
      copy.querySelectorAll("[class*='visually-hidden'], [class*='sr-only'], [aria-hidden='true']").forEach((n) => n.remove());
      return (copy.textContent || "").replace(/\\s+/g, " ").trim();
    };
    const all = [...document.querySelectorAll("a, button, [role='button']")];
    const score = (el) => {
      const t = text(el).toLowerCase().replace(/\\(this will open in a new (window|tab)[^)]*\\)/g, "").trim();
      if (!t || t.length > 160) return -1;
      if (/no thanks|apply without|without regist|as a guest|skip (this|registration|and)/.test(t)) return 12;
      if (/alert|save|share|sign in|log in|register|sign up|create (an )?account|email this|print/.test(t)) return -1;
      if (/continue to apply/.test(t)) return 10;
      if (/^apply( now| for this job| online| here)?$/.test(t)) return 8;
      if (/apply/.test(t)) return 5;
      return -1;
    };
    const ranked = all.map((el) => ({ el, s: score(el) })).filter((x) => x.s > 0 && x.el.offsetParent !== null).sort((a, b) => b.s - a.s);
    return ranked[0] ? ranked[0].el : null;
  })()`);
  const el = candidate.asElement() as ElementHandle<HTMLElement> | null;
  if (!el) return null;
  const label = await el.evaluate((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim());
  const href = await el.evaluate((e) => (e as HTMLAnchorElement).href || "");
  const key = `${page.url()}|${label}|${href}`;
  // Clicking it once did nothing visible (a modal, say): go to its address
  // directly, or give up rather than click the same thing again.
  const again = seen.has(key);
  seen.add(key);
  if (again && (!href || href === page.url() || href.startsWith("javascript:"))) return null;
  log.push(`${again ? "Going straight to" : "Following"} "${label}"${href ? ` → ${href}` : ""}`);
  if (again) {
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => null);
    await sleep(2500);
    return page;
  }
  const startUrl = page.url();
  const popupPromise = new Promise<Page | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 6000);
    const onTarget = async (t: Target) => {
      if (t.type() !== "page") return;
      browser.off("targetcreated", onTarget);
      clearTimeout(timer);
      resolve(await t.page().catch(() => null));
    };
    browser.on("targetcreated", onTarget);
    setTimeout(() => browser.off("targetcreated", onTarget), 6000);
  });
  const navPromise = page.waitForNavigation({ timeout: 8000, waitUntil: "domcontentloaded" }).catch(() => null);
  await el.click().catch(async () => {
    if (href) await page.goto(href, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => null);
  });
  const popup = await popupPromise;
  await navPromise;
  const target = popup ?? page;
  await target.bringToFront().catch(() => {});
  // Slow redirect chains (sign-in services) can take longer than the wait above.
  if (!popup && page.url() === startUrl) {
    for (let i = 0; i < 6 && page.url() === startUrl; i += 1) await sleep(1000);
  }
  // A real click can land on an overlay; the element's own click() cannot.
  if (!popup && page.url() === startUrl && !again) {
    const nav2 = page.waitForNavigation({ timeout: 10_000, waitUntil: "domcontentloaded" }).catch(() => null);
    await el.evaluate((e) => e.click()).catch(() => {});
    await nav2;
  }
  await settle(target);
  return target;
}

/** Waits for pages that redirect on a timer ("you will be redirected in 5 seconds"). */
async function settle(page: Page) {
  await sleep(2500);
  const bodyText = () => page.evaluate(() => document.body?.innerText || "").catch(() => "");
  for (let i = 0; i < 6; i += 1) {
    const url = page.url();
    if (!/redirect(ed|ing)? (you )?(automatically |in |after |to )/i.test(await bodyText())) break;
    await page.waitForNavigation({ timeout: 4000, waitUntil: "domcontentloaded" }).catch(() => null);
    await sleep(1500);
    if (page.url() === url) break;
  }
  // Sites that draw a "please wait" curtain while they load the real page.
  for (let i = 0; i < 8; i += 1) {
    if (!/please wait|processing\b|loading\.{2,}/i.test((await bodyText()).slice(0, 3000))) break;
    await sleep(1500);
  }
}

async function fillField(page: Page, field: FormField, plan: PlannedValue, cvPath: string, log: string[]) {
  const sel = `[data-applya="${field.id}"]`;
  if (plan.action === "skip") return;
  if (plan.action === "file") {
    const handle = (await page.$(sel)) as ElementHandle<HTMLInputElement> | null;
    if (!handle) return;
    await handle.uploadFile(cvPath);
    await sleep(800);
    log.push(`Uploaded CV to "${field.label || field.name}"`);
    return;
  }
  if (plan.action === "check" || (plan.action === "select" && (field.type === "radio" || field.type === "checkbox"))) {
    const wanted = (Array.isArray(plan.value) ? plan.value : [plan.value ?? ""]).map((v) => String(v).trim().toLowerCase());
    for (let i = 0; i < field.options.length; i += 1) {
      const o = field.options[i];
      const hit = wanted.some((w) => w && (o.label.toLowerCase() === w || o.value.toLowerCase() === w || o.label.toLowerCase().startsWith(w) || w.startsWith(o.label.toLowerCase().slice(0, 12))));
      if (!hit) continue;
      const opt = await page.$(`[data-applya="${field.id}:${i}"]`);
      if (opt) {
        await opt.evaluate((e) => (e as HTMLElement).scrollIntoView({ block: "center" }));
        const checked = await opt.evaluate((e) => (e as HTMLInputElement).checked);
        if (!checked) await opt.click({ delay: 20 }).catch(async () => opt.evaluate((e) => (e as HTMLElement).click()));
        log.push(`Chose "${o.label}" for "${field.label || field.name}"`);
      }
      if (field.type === "radio") break;
    }
    return;
  }
  let value = Array.isArray(plan.value) ? plan.value.join(", ") : (plan.value ?? "");
  if (!value) return;
  // A phone box with its own country-code picker wants the national number.
  if (field.type === "tel" || /phone|mobile/i.test(field.label)) {
    const hasCountryPicker = await page.$(sel).then((h) => h?.evaluate((e) => Boolean((e.closest("div, fieldset, li") || e).querySelector("select, [role='combobox'], [class*='country'], [class*='flag'], [class*='dial'], [class*='intl']"))).catch(() => false));
    if (hasCountryPicker && /^\+44/.test(value.replace(/\s+/g, ""))) value = value.replace(/\s+/g, "").replace(/^\+44/, "0");
  }
  if (plan.action === "select" && field.tag === "select") {
    const match = field.options.find((o) => o.label.toLowerCase() === value.toLowerCase() || o.value.toLowerCase() === value.toLowerCase()) ?? field.options.find((o) => o.label.toLowerCase().includes(value.toLowerCase()));
    if (match) {
      await page.select(sel, match.value);
      log.push(`Selected "${match.label}" for "${field.label || field.name}"`);
    }
    return;
  }
  const handle = await page.$(sel);
  if (!handle) return;
  await handle.evaluate((e) => (e as HTMLElement).scrollIntoView({ block: "center" }));
  await handle.click({ count: 3 }).catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await handle.type(value.slice(0, 4000), { delay: 5 });
  if (field.combobox || plan.action === "select") {
    await sleep(900);
    await page.keyboard.press("ArrowDown").catch(() => {});
    await page.keyboard.press("Enter").catch(() => {});
    await sleep(300);
  }
  log.push(`Filled "${field.label || field.name || field.placeholder}"`);
}

async function findButton(page: Page, kind: "submit" | "next") {
  const re = kind === "submit" ? "/^(submit|submit application|send application|apply|apply now|send|complete application|finish|submit my application)$|submit/" : "/^(next|continue|next step|save and continue|save|proceed)$|^next\\b|continue/";
  const handle = await page.evaluateHandle(`(() => {
    const text = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const all = [...document.querySelectorAll("button, input[type=submit], input[type=button], a, [role=button], [role=link], span, div")].filter((el) => {
      if (/^(BUTTON|INPUT)$/.test(el.tagName) || el.getAttribute("role") === "button") return true;
      // Links and styled elements only when they look like a button and are the innermost such thing.
      return getComputedStyle(el).cursor === "pointer" && !el.querySelector("button, a, input, [role=button]") && text(el).length < 40;
    });
    const visible = (el) => (el.offsetParent !== null || getComputedStyle(el).position === "fixed") && !el.disabled;
    const re = ${re};
    const ok = all.filter((el) => visible(el) && re.test(text(el)) && !/cancel|back|previous|sign in|log in/.test(text(el)));
    // The most specific wording wins: "submit application" over a page's own "apply now".
    const rank = (el) => { const t = text(el); return /submit|send|complete|finish/.test(t) ? 2 : /continue|next/.test(t) ? 1 : 0; };
    return ok.sort((a, b) => rank(b) - rank(a))[0] || null;
  })()`);
  return handle.asElement() as ElementHandle<HTMLElement> | null;
}

/**
 * Tries each route to the vacancy in turn: the employer's or agency's own
 * pages first (no job-board account needed), then the advert itself. A route
 * that ends at a sign-in wall, a CAPTCHA or without a form hands over to the
 * next; anything decisive (submitted, previewed, needs an answer) is final.
 */
export async function runApply(packet: ApplyPacket, deps: RunnerDeps): Promise<ApplyReport> {
  const advert = packet.job.applyUrl || packet.job.url;
  const routes = [...new Set([...(packet.job.alternatives ?? []), advert])];
  const log: string[] = [];
  let last: ApplyReport | null = null;
  for (const [i, start] of routes.entries()) {
    if (i > 0) log.push(`Trying another route: ${start}`);
    const report = await runApplyAt(packet, deps, start, start !== advert, log);
    const handOver = report.status === "NEEDS_YOU" && /sign in|create an account|CAPTCHA|couldn't find an application form|isn't about this vacancy/i.test(report.detail);
    if (!handOver || i === routes.length - 1) return { ...report, log };
    last = report;
  }
  return last ? { ...last, log } : { status: "FAILED", detail: "No route to the vacancy.", finalUrl: advert, log };
}

async function runApplyAt(packet: ApplyPacket, deps: RunnerDeps, start: string, alternative: boolean, log: string[]): Promise<ApplyReport> {
  const say = (line: string) => {
    log.push(line);
    deps.progress?.(line);
  };
  const dir = await mkdtemp(join(tmpdir(), "applya-"));
  const cvPath = join(dir, packet.applicant.cvFileName || "CV.pdf");
  await writeFile(cvPath, Buffer.from(packet.applicant.cvPdfBase64, "base64"));

  let page = await deps.browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1280, height: 1000 });
  page.setDefaultTimeout(NAV_TIMEOUT);

  let openQuestions: OpenQuestion[] = [];
  const finish = async (status: ApplyReport["status"], detail: string): Promise<ApplyReport> => {
    say(detail);
    return { status, detail, finalUrl: page.url(), log, screenshotBase64: await screenshot(page), questions: openQuestions };
  };
  /** Required questions the plan had no honest answer for. */
  const unanswered = (fields: FormField[], plan: PlannedValue[]) =>
    fields
      .filter((f) => f.required && f.type !== "hidden" && f.type !== "password" && !f.value.trim())
      .filter((f) => {
        const p = plan.find((v) => v.id === f.id);
        if (!p || p.action === "skip") return true;
        if (p.action === "file") return false;
        const v = Array.isArray(p.value) ? p.value.join("") : (p.value ?? "");
        return !v.trim();
      })
      .map((f) => ({ field: f, name: (f.label || f.placeholder || f.name).replace(/\s*\*?\s*(required)?\s*$/i, "").slice(0, 160) }))
      .filter(({ name }, i, all) => name && !/^select\.{0,3}$/i.test(name) && all.findIndex((x) => x.name === name) === i);

  try {
    say(`Opening ${start}`);
    await page.goto(start, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await sleep(2500);
    if (alternative) {
      // Make sure the page found by search is this vacancy before applying on it.
      const heading = (await page.evaluate(() => `${document.title} ${[...document.querySelectorAll("h1, h2")].slice(0, 3).map((h) => h.textContent).join(" ")}`).catch(() => "")).toLowerCase();
      const words = packet.job.title.toLowerCase().split(/\s[–—-]\s|\(|,|\|/)[0].replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
      const hits = words.filter((w) => heading.includes(w)).length;
      if (!words.length || hits / words.length < 0.6) return finish("NEEDS_YOU", `The page at ${new URL(start).hostname} isn't about this vacancy.`);
    }

    // 1. Get to the form: follow Apply links, at most 5 hops.
    let fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
    const followed = new Set<string>();
    let signedIn = false;
    const accountWall = async () => {
      const login = loginFor(page, packet.logins);
      if (!login) return finish("NEEDS_YOU", `This site (${new URL(page.url()).hostname}) wants you to sign in or create an account before applying. Add your login for it under Account → Job site logins and try again, or apply there yourself.`);
      if (signedIn) return finish("NEEDS_YOU", `${login.host} asked to sign in again after signing in; finish the application there yourself.`);
      return null;
    };
    for (let hop = 0; hop < 8 && !looksLikeForm(fields); hop += 1) {
      if (looksLikeLogin(fields)) {
        const stop = await accountWall();
        if (stop) return stop;
        const login = loginFor(page, packet.logins)!;
        signedIn = true;
        if (!(await signIn(page, fields, login, log))) return finish("NEEDS_YOU", `Signing in to ${login.host} as ${login.username} didn't work; check the login under Account → Job site logins.`);
        fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
        followed.clear();
        continue;
      }
      const next = await followApplyLink(page, deps.browser, log, followed);
      if (!next) break;
      page = next;
      await page.setViewport({ width: 1280, height: 1000 }).catch(() => {});
      fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
    }
    if (looksLikeLogin(fields) && !looksLikeForm(fields)) return (await accountWall()) ?? finish("NEEDS_YOU", "This site wants you to sign in before applying.");
    // No more Apply links, but questions and a Continue button: a multi-step
    // flow that starts with screening questions.
    // A pop-up that only shows the saved CV and a Submit button has no
    // fields yet: its "Update CV" control reveals the file input.
    await dismissCookieBanner(page);
    if (!looksLikeForm(fields) && !fields.some((f) => f.type === "file") && (await revealCvUpload(page, log))) fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
    const stepStart = !looksLikeForm(fields) && fields.length > 0 && Boolean((await findButton(page, "next")) ?? (await findButton(page, "submit")));
    if (!looksLikeForm(fields) && !stepStart) {
      log.push(`What the browser could see: ${await describePage(page)}`);
      return finish("NEEDS_YOU", "Couldn't find an application form on this site; apply there yourself with the CV and message from this page.");
    }
    say(`Found a form with ${fields.length} fields at ${page.url()}`);
    await dismissCookieBanner(page);

    // 2. Fill page after page (multi-step forms), at most 6 steps.
    for (let step = 0; step < 10; step += 1) {
      if (step > 0) fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
      if (fields.length === 0) break;
      if (looksLikeLogin(fields)) {
        const stop = await accountWall();
        if (stop) return stop;
        const login = loginFor(page, packet.logins)!;
        signedIn = true;
        if (!(await signIn(page, fields, login, log))) return finish("NEEDS_YOU", `Signing in to ${login.host} as ${login.username} didn't work; check the login under Account → Job site logins.`);
        fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
        if (fields.length === 0) {
          // Back on the advert after signing in: find the Apply button again.
          const next = await followApplyLink(page, deps.browser, log, new Set());
          if (next) { page = next; fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[]; }
        }
        if (fields.length === 0) break;
      }
      // A site that applies with the CV saved on the account: press its
      // "Update CV" so our file input appears, else it has to be done by hand.
      const cvChooser = fields.some((f) => f.options.some((o) => /\.(pdf|docx?|rtf)$/i.test(o.label.trim())) || /choose (a |your )?cv|select (a |your )?cv|which cv|your cv on file|saved cv/i.test(f.label + " " + f.context));
      if (!fields.some((f) => f.type === "file") && (await revealCvUpload(page, log))) {
        fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
      }
      if (cvChooser && !fields.some((f) => f.type === "file")) {
        return finish("NEEDS_YOU", `${new URL(page.url()).hostname} applies with the CV saved on your account there and doesn't let the browser upload this one. Download the tailored CV from this page, upload it on the site, then press Apply there.`);
      }
      const text = await pageText(page);
      const plan = await deps.plan(fields, text);
      for (const field of fields) {
        const p = plan.find((v) => v.id === field.id);
        if (!p) continue;
        try {
          await fillField(page, field, p, cvPath, log);
        } catch (error) {
          log.push(`Couldn't fill "${field.label || field.name}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await sleep(1000);
      if (fields.some((f) => f.type === "file")) await waitForUploads(page, log);
      const open = unanswered(fields, plan);
      const missing = open.map((o) => o.name);
      openQuestions = open.map(({ field, name }) => ({ label: name, type: field.type, options: field.options.map((o) => o.label).slice(0, 40), context: field.context.slice(0, 300) }));
      if (missing.length) log.push(`No answer in your profile for: ${missing.join("; ")}`);
      const submit = await findButton(page, "submit");
      const next = submit ? null : await findButton(page, "next");
      if (!submit && !next) return finish("NEEDS_YOU", "Filled the form but couldn't find its Submit button.");
      if (packet.dryRun && submit) return finish("PREVIEWED", missing.length ? `Filled in, not submitted (preview). Additional information required: ${missing.join("; ")}.` : "Filled in, not submitted (preview).");
      // Never guess: stop here and ask rather than submit a half-answered form.
      if (missing.length) return finish("NEEDS_YOU", `Additional information required: ${missing.join("; ")}. Answer below and the browser will carry on.`);
      await dismissCookieBanner(page);
      await tickCaptchaBox(page, log);
      if (await hasCaptchaChallenge(page)) return finish("NEEDS_YOU", "The site is showing a CAPTCHA, which has to be solved by a person.");
      const button = (submit ?? next)!;
      const label = await button.evaluate((e) => (e.innerText || (e as HTMLInputElement).value || "").trim());
      const before = page.url();
      const beforeText = await pageText(page);
      say(`Pressing "${label}"`);
      const nav = page.waitForNavigation({ timeout: 12_000, waitUntil: "domcontentloaded" }).catch(() => null);
      await button.evaluate((e) => e.scrollIntoView({ block: "center" })).catch(() => {});
      await button.click().catch(() => {});
      // If nothing happened (an overlay took the click), press it from inside the page.
      await Promise.race([nav, sleep(2500)]);
      if (page.url() === before && (await pageText(page)) === beforeText) await button.evaluate((e) => e.click()).catch(() => {});
      await nav;
      await sleep(3000);
      const after = await pageText(page);
      if (await hasCaptchaChallenge(page)) return finish("NEEDS_YOU", "The site asked for a CAPTCHA after pressing submit.");
      const success = /thank you for (your )?(applying|application)|thanks for applying|application (has been |was |is )?(received|submitted|sent|complete|successful)|we have received your application|successfully (submitted|applied|sent)|you have (successfully )?applied|application confirmed|your application has gone/i.test(after) && after !== beforeText;
      // Only the site's own confirmation counts as submitted.
      if (success) return finish("SUBMITTED", `Submitted: the site confirmed the application${page.url() !== before ? ` (${page.url()})` : ""}.`);
      const remaining = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
      const errors = /this field is required|is required|please (fill|enter|select|complete|upload|choose|answer)|invalid|must be|required field|can't be blank|cannot be (blank|empty)/i.test(after) && after !== beforeText;
      const samePlace = after === beforeText && page.url() === before;
      const sameFields = remaining.length === fields.length && remaining.every((r, i) => r.label === fields[i].label && r.type === fields[i].type);
      if (samePlace) return finish("NEEDS_YOU", `Pressed "${label}" but the form didn't move on; some answers need you.`);
      if (sameFields && errors) return finish("NEEDS_YOU", "The form came back with validation messages; some answers need you.");
      if (remaining.length === 0 || (sameFields && !errors && submit)) {
        if (submit) return finish("NEEDS_YOU", `Pressed "${label}" but the site didn't confirm that the application was received. Check on the site before relying on it.`);
        return finish("NEEDS_YOU", `Pressed "${label}" and the form ended without a confirmation; finish it on the site.`);
      }
      // More questions on the next page: carry on.
      say(`Next step at ${page.url()} with ${remaining.length} fields`);
    }
    return finish("NEEDS_YOU", "The form has more steps than expected; finish it yourself from the link.");
  } catch (error) {
    return finish("FAILED", `Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
  }
}
