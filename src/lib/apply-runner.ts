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
  job: { url: string; applyUrl?: string | null; title: string; company: string };
  applicant: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    website: string;
    summary: string;
    coverMessage: string;
    facts: { availability: string; noticePeriod: string; rightToWork: string; salary: string; visaExpiresAt: string };
    cvFileName: string;
    cvPdfBase64: string;
  };
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
  const controls = [...document.querySelectorAll("input, select, textarea")].filter((el) => !["hidden", "submit", "button", "reset", "image"].includes(el.type) && !el.disabled && !el.readOnly && (visible(el) || el.type === "file"));
  const out = []; const groups = new Map(); let n = 0;
  for (const el of controls) {
    if (el.closest("[data-applya-ignore]")) continue;
    const type = (el.type || el.tagName.toLowerCase());
    if ((type === "radio" || type === "checkbox") && el.name) {
      const key = type + ":" + el.name;
      let g = groups.get(key);
      if (!g) { g = { id: n, tag: "input", type, name: el.name, label: "", placeholder: "", required: false, options: [], combobox: false, context: context(el) }; groups.set(key, g); out.push(g); n++; }
      const optLabel = optionLabel(el) || labelFor(el) || el.value;
      el.setAttribute("data-applya", String(g.id) + ":" + g.options.length);
      g.options.push({ value: el.value, label: optLabel });
      g.required = g.required || el.required || !!el.closest("[aria-required='true'], .required");
      // The question is whatever labels the group, not the option.
      const fs = el.closest("fieldset"); const legend = fs ? text(fs.querySelector("legend")) : "";
      g.label = legend || g.context.split(optLabel)[0].trim().slice(0, 200) || g.label;
      continue;
    }
    el.setAttribute("data-applya", String(n));
    const options = el.tagName === "SELECT" ? [...el.options].map((o) => ({ value: o.value, label: text(o) })).filter((o) => o.value !== "") : [];
    const combobox = el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list" || !!el.closest("[class*='select__'], [class*='Select'], [role='combobox']");
    out.push({ id: n, tag: el.tagName.toLowerCase(), type, name: el.name || "", label: labelFor(el), placeholder: el.placeholder || "", required: el.required || el.getAttribute("aria-required") === "true" || /\\*/.test(labelFor(el)), options, combobox, context: context(el) });
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
  const hasName = fields.some((f) => /name/i.test(f.label));
  return hasFile || (hasEmail && hasName && fields.length >= 3);
}

/** A sign-in wall: a password box and no way to apply without one. */
function looksLikeLogin(fields: FormField[]) {
  return fields.some((f) => f.type === "password") && !fields.some((f) => f.type === "file");
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
  const value = Array.isArray(plan.value) ? plan.value.join(", ") : (plan.value ?? "");
  if (!value) return;
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
  const re = kind === "submit" ? "/^(submit|submit application|send application|apply|apply now|send|complete application|finish|submit my application)$|submit/" : "/^(next|continue|next step|save and continue|proceed)$|^next\\b|continue/";
  const handle = await page.evaluateHandle(`(() => {
    const text = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const all = [...document.querySelectorAll("button, input[type=submit], a[role=button], [role=button]")];
    const visible = (el) => el.offsetParent !== null && !el.disabled;
    const re = ${re};
    return all.find((el) => visible(el) && re.test(text(el)) && !/cancel|back|previous|sign in|log in/.test(text(el))) || null;
  })()`);
  return handle.asElement() as ElementHandle<HTMLElement> | null;
}

export async function runApply(packet: ApplyPacket, deps: RunnerDeps): Promise<ApplyReport> {
  const log: string[] = [];
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

  const finish = async (status: ApplyReport["status"], detail: string): Promise<ApplyReport> => {
    say(detail);
    return { status, detail, finalUrl: page.url(), log, screenshotBase64: await screenshot(page) };
  };
  /** Required questions the plan had no honest answer for. */
  const unanswered = (fields: FormField[], plan: PlannedValue[]) =>
    fields
      .filter((f) => f.required && f.type !== "hidden" && f.type !== "password")
      .filter((f) => {
        const p = plan.find((v) => v.id === f.id);
        if (!p || p.action === "skip") return true;
        if (p.action === "file") return false;
        const v = Array.isArray(p.value) ? p.value.join("") : (p.value ?? "");
        return !v.trim();
      })
      .map((f) => (f.label || f.placeholder || f.name).replace(/\s*\*?\s*(required)?\s*$/i, "").slice(0, 80))
      .filter((name, i, all) => name && !/^select\.{0,3}$/i.test(name) && all.indexOf(name) === i);

  try {
    const start = packet.job.applyUrl || packet.job.url;
    say(`Opening ${start}`);
    await page.goto(start, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await sleep(2500);

    // 1. Get to the form: follow Apply links, at most 5 hops.
    let fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
    const followed = new Set<string>();
    for (let hop = 0; hop < 6 && !looksLikeForm(fields); hop += 1) {
      if (looksLikeLogin(fields) && hop > 0) break;
      const next = await followApplyLink(page, deps.browser, log, followed);
      if (!next) break;
      page = next;
      await page.setViewport({ width: 1280, height: 1000 }).catch(() => {});
      fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
    }
    if (looksLikeLogin(fields) && !looksLikeForm(fields)) return finish("NEEDS_YOU", "This site wants you to sign in or create an account before applying.");
    // No more Apply links, but questions and a Continue button: a multi-step
    // flow that starts with screening questions.
    const stepStart = !looksLikeForm(fields) && fields.length > 0 && Boolean((await findButton(page, "next")) ?? (await findButton(page, "submit")));
    if (!looksLikeForm(fields) && !stepStart) return finish("NEEDS_YOU", "Couldn't find an application form on this site; apply there yourself with the CV and message from this page.");
    say(`Found a form with ${fields.length} fields at ${page.url()}`);

    // 2. Fill page after page (multi-step forms), at most 6 steps.
    for (let step = 0; step < 10; step += 1) {
      if (step > 0) fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
      if (fields.length === 0) break;
      if (looksLikeLogin(fields)) return finish("NEEDS_YOU", "This site wants you to sign in or create an account to carry on applying.");
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
      const missing = unanswered(fields, plan);
      if (missing.length) log.push(`No answer in your profile for: ${missing.join("; ")}`);
      const submit = await findButton(page, "submit");
      const next = submit ? null : await findButton(page, "next");
      if (!submit && !next) return finish("NEEDS_YOU", "Filled the form but couldn't find its Submit button.");
      if (packet.dryRun && submit) return finish("PREVIEWED", missing.length ? `Filled in, not submitted (preview). Additional information required: ${missing.join("; ")}.` : "Filled in, not submitted (preview).");
      // Never guess: stop here and ask rather than submit a half-answered form.
      if (missing.length) return finish("NEEDS_YOU", `Additional information required: ${missing.join("; ")}. Add it to your profile (or answer on the site) and try again.`);
      if (await hasCaptchaChallenge(page)) return finish("NEEDS_YOU", "The site is showing a CAPTCHA, which has to be solved by a person.");
      const button = (submit ?? next)!;
      const label = await button.evaluate((e) => (e.innerText || (e as HTMLInputElement).value || "").trim());
      const before = page.url();
      const beforeText = await pageText(page);
      say(`Pressing "${label}"`);
      const nav = page.waitForNavigation({ timeout: 12_000, waitUntil: "domcontentloaded" }).catch(() => null);
      await button.click().catch(() => button.evaluate((e) => e.click()));
      await nav;
      await sleep(3000);
      const after = await pageText(page);
      if (await hasCaptchaChallenge(page)) return finish("NEEDS_YOU", "The site asked for a CAPTCHA after pressing submit.");
      const success = /thank you|thanks for applying|application (has been |was )?(received|submitted|sent|complete)|we have received|successfully (submitted|applied|sent)|you have applied|application confirmed/i.test(after);
      if (submit) {
        if (success) return finish("SUBMITTED", `Submitted: the site confirmed the application${page.url() !== before ? ` (${page.url()})` : ""}.`);
        const errors = /this field is required|is required|please (fill|enter|select|complete|upload)|invalid|must be|required field|can't be blank/i.test(after) && after !== beforeText;
        const remaining = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
        if (errors || looksLikeForm(remaining)) return finish("NEEDS_YOU", "The form came back with validation messages; some answers need you.");
        return finish("SUBMITTED", "Submitted: the form was accepted (no confirmation text found, so check your inbox).");
      }
      // A "next" step: carry on with the new page's fields.
      if (after === beforeText && page.url() === before) return finish("NEEDS_YOU", `Pressed "${label}" but the form didn't move on; some answers need you.`);
    }
    return finish("NEEDS_YOU", "The form has more steps than expected; finish it yourself from the link.");
  } catch (error) {
    return finish("FAILED", `Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
  }
}
