import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";

// One place that asks a language model for JSON. Every provider with a key
// is in the queue; a call goes to the first one that is not resting, and
// when a provider answers with a rate limit, exhausted quota, an outage or
// nonsense, it is rested for a while and the next provider takes over. Free
// tiers come first, Anthropic last as the paid backstop. AI_PROVIDER can be
// one name or a comma-separated order.
//
// Model names on the free providers change often, so each provider's model
// is picked from its own model list (ranked by family and size, cached for
// a day) unless a *_MODEL variable names one. A "model not found" answer
// refreshes the list and tries the next candidate straight away.

export type Provider = "groq" | "gemini" | "openrouter" | "cloudflare" | "anthropic";

export const ALL_PROVIDERS: Provider[] = ["groq", "gemini", "openrouter", "cloudflare", "anthropic"];

/** Used when a provider's list can't be read. */
const FALLBACK_MODELS: Record<Provider, string> = {
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-3.8-flash",
  openrouter: "qwen/qwen3.8-27b:free",
  cloudflare: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  anthropic: "claude-opus-5-5",
};

/** Per-provider model overrides, e.g. GROQ_MODEL. */
const MODEL_ENV: Record<Provider, string> = {
  groq: "GROQ_MODEL",
  gemini: "GEMINI_MODEL",
  openrouter: "OPENROUTER_MODEL",
  cloudflare: "CLOUDFLARE_AI_MODEL",
  anthropic: "ANTHROPIC_MODEL",
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  groq: "Groq (free tier)",
  gemini: "Google Gemini (free tier)",
  openrouter: "OpenRouter (free models)",
  cloudflare: "Cloudflare Workers AI (free allowance)",
  anthropic: "Anthropic Claude (paid)",
};

const MODEL_CACHE_MS = 24 * 60 * 60_000;
const CALL_TIMEOUT_MS = 25_000;

export function isConfigured(p: Provider) {
  const env = process.env;
  switch (p) {
    case "groq":
      return Boolean(env.GROQ_API_KEY?.trim());
    case "gemini":
      return Boolean(env.GEMINI_API_KEY?.trim());
    case "openrouter":
      return Boolean(env.OPENROUTER_API_KEY?.trim());
    case "cloudflare":
      return Boolean(env.CLOUDFLARE_ACCOUNT_ID?.trim() && env.CLOUDFLARE_AI_TOKEN?.trim());
    case "anthropic":
      return Boolean(env.ANTHROPIC_API_KEY?.trim());
  }
}

/** The providers with keys, in the order they are tried. */
export function providerQueue(): Provider[] {
  const wanted = (process.env.AI_PROVIDER ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Provider => (ALL_PROVIDERS as string[]).includes(s));
  const order = wanted.length ? [...wanted, ...ALL_PROVIDERS.filter((p) => !wanted.includes(p))] : ALL_PROVIDERS;
  return order.filter(isConfigured);
}

export function aiAvailable() {
  return providerQueue().length > 0;
}

// --- Choosing a model from the provider's list ------------------------------

const size = (id: string) => {
  const m = /(\d+(?:\.\d+)?)b\b/i.exec(id);
  return m ? Number(m[1]) : 0;
};
const version = (id: string, family: string) => {
  const m = new RegExp(`${family}[- _]?(\\d+(?:\\.\\d+)?)`, "i").exec(id);
  return m ? Number(m[1]) : 0;
};
const has = (id: string, ...words: string[]) => words.some((w) => id.toLowerCase().includes(w));

/** Models that aren't general chat models. */
const EXCLUDE = ["whisper", "tts", "audio", "speech", "embed", "guard", "safety", "moderation", "image", "vision", "live", "video", "ocr", "rerank", "compound", "code", "note", "omni", "prompt"];

/** Scores a chat model id: family we trust + a sensible size (20–130B is the sweet spot for speed and quality). */
function score(id: string): number {
  const lower = id.toLowerCase();
  if (EXCLUDE.some((w) => lower.includes(w))) return -1;
  let s = 0;
  if (has(lower, "llama")) s += 40 + version(lower, "llama") * 2;
  else if (has(lower, "qwen")) s += 38 + version(lower, "qwen") * 2;
  else if (has(lower, "gemma")) s += 34 + version(lower, "gemma") * 2;
  else if (has(lower, "nemotron")) s += 32 + version(lower, "nemotron") * 2;
  else if (has(lower, "deepseek")) s += 32;
  else if (has(lower, "gpt-oss")) s += 36;
  else if (has(lower, "mistral", "mixtral")) s += 30;
  else if (has(lower, "kimi", "moonshot")) s += 28;
  else s += 10;
  const b = size(lower);
  s += b >= 20 && b <= 130 ? 20 : b > 130 ? 10 : b > 0 ? b / 2 : 8;
  if (has(lower, "instruct", "-it", "chat", "versatile")) s += 3;
  if (has(lower, "preview", "exp", "beta")) s -= 4;
  if (has(lower, "lite", "mini", "nano", "small", "tiny", "xs")) s -= 10;
  return s;
}

export function pick(ids: string[], exclude: Set<string>) {
  return ids
    .filter((id) => !exclude.has(id))
    .map((id) => ({ id, s: score(id) }))
    .filter((m) => m.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((m) => m.id);
}

/** Gemini: the newest stable "flash" model that can generate content. */
function pickGemini(models: { name: string; supportedGenerationMethods?: string[] }[], exclude: Set<string>) {
  const ids = models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((id) => !exclude.has(id) && /^gemini-\d/.test(id) && !/lite|image|tts|live|audio|embedding|thinking|robotics|computer|preview|exp|-\d{3}$/i.test(id));
  const flash = ids.filter((id) => /flash/.test(id)).sort((a, b) => version(b, "gemini") - version(a, "gemini"));
  const rest = ids.filter((id) => !/flash/.test(id)).sort((a, b) => version(b, "gemini") - version(a, "gemini"));
  return [...flash, ...rest];
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} listing models at ${new URL(url).host}`);
  return (await res.json()) as T;
}

/** The provider's current chat models, best first. Empty when the list can't be read. */
async function listCandidates(p: Provider, exclude: Set<string>): Promise<string[]> {
  try {
    switch (p) {
      case "groq": {
        const data = await getJson<{ data: { id: string }[] }>("https://api.groq.com/openai/v1/models", { authorization: `Bearer ${process.env.GROQ_API_KEY!.trim()}` });
        return pick(data.data.map((m) => m.id), exclude);
      }
      case "gemini": {
        const data = await getJson<{ models: { name: string; supportedGenerationMethods?: string[] }[] }>("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": process.env.GEMINI_API_KEY!.trim() });
        return pickGemini(data.models ?? [], exclude);
      }
      case "openrouter": {
        const data = await getJson<{ data: { id: string; context_length?: number }[] }>("https://openrouter.ai/api/v1/models", {});
        return pick(data.data.filter((m) => m.id.endsWith(":free") && (m.context_length ?? 0) >= 16_000).map((m) => m.id), exclude);
      }
      case "cloudflare": {
        const data = await getJson<{ result: { name: string }[] }>(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID!.trim()}/ai/models/search?task=Text%20Generation&per_page=100`, { authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN!.trim()}` });
        return pick(data.result.map((m) => m.name).filter((n) => !/awq|int8|base$|-lora/i.test(n)), exclude);
      }
      case "anthropic":
        return [];
    }
  } catch (error) {
    console.warn(`[llm] couldn't list ${p} models: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** The model to use for a provider: the override, the cached pick, or a fresh pick from its list. */
async function modelFor(p: Provider, options: { refresh?: boolean; exclude?: Set<string> } = {}): Promise<string> {
  const override = process.env[MODEL_ENV[p]]?.trim() || (p === "anthropic" ? process.env.TAILOR_MODEL?.trim() : "");
  if (override) return override;
  if (p === "anthropic") return FALLBACK_MODELS.anthropic;
  const exclude = options.exclude ?? new Set<string>();
  if (!options.refresh) {
    const state = await db.aiProviderState.findUnique({ where: { provider: p } });
    if (state?.model && !exclude.has(state.model) && state.modelCheckedAt && state.modelCheckedAt.getTime() > Date.now() - MODEL_CACHE_MS) return state.model;
  }
  const candidates = await listCandidates(p, exclude);
  const chosen = candidates[0] ?? FALLBACK_MODELS[p];
  await db.aiProviderState.upsert({ where: { provider: p }, create: { provider: p, model: chosen, modelCheckedAt: new Date() }, update: { model: chosen, modelCheckedAt: new Date() } });
  return chosen;
}

// --- Calling --------------------------------------------------------------

export interface JsonRequest {
  system: string;
  user: string;
  maxTokens?: number;
  /** Stop trying further providers after this long (a serverless request has ~25 s in all). */
  budgetMs?: number;
}

export interface JsonResult<T> {
  data: T;
  provider: Provider;
  model: string;
}

/** How long a provider rests after each kind of trouble. */
const REST = {
  rateLimited: 5 * 60_000,
  quota: 60 * 60_000,
  outage: 2 * 60_000,
  badKey: 6 * 60 * 60_000,
  badAnswer: 60_000,
  badModel: 0,
};

class ProviderError extends Error {
  constructor(
    message: string,
    public restMs: number,
    public modelNotFound = false,
  ) {
    super(message);
  }
}

/** Turns an HTTP failure into how long to rest the provider. */
function classify(status: number, body: string, retryAfter: string | null): ProviderError {
  const detail = body.slice(0, 200).replace(/\s+/g, " ");
  if (status === 404 || /model_not_found|does not exist|no longer available|not found|unavailable for free|decommissioned/i.test(body)) {
    return new ProviderError(`model not available (${detail})`, REST.badModel, true);
  }
  if (status === 429) {
    const secs = Number(retryAfter);
    const quota = /quota|daily|per day|RESOURCE_EXHAUSTED|exceeded your current/i.test(body);
    return new ProviderError(`rate limited (${detail})`, Number.isFinite(secs) && secs > 0 ? Math.min(secs * 1000, REST.quota) : quota ? REST.quota : REST.rateLimited);
  }
  if (status === 402 || (status === 403 && /quota|billing|credit|exhausted/i.test(body))) return new ProviderError(`quota or credits exhausted (${detail})`, REST.quota);
  if (status === 401 || status === 403) return new ProviderError(`key rejected (${detail})`, REST.badKey);
  if (status >= 500 || status === 408) return new ProviderError(`service trouble ${status} (${detail})`, REST.outage);
  return new ProviderError(`${status} (${detail})`, REST.outage);
}

function extractJson(text: string) {
  const unfenced = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (error) {
    throw new ProviderError(`unreachable (${error instanceof Error ? error.message : String(error)})`, REST.outage);
  }
  if (!res.ok) throw classify(res.status, await res.text(), res.headers.get("retry-after"));
  return (await res.json()) as T;
}

interface OpenAiStyle {
  choices?: { message?: { content?: string | { text?: string }[] } }[];
}

const asText = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : ((x as { text?: string })?.text ?? ""))).join("") : v == null ? "" : JSON.stringify(v));

async function callProvider(provider: Provider, model: string, req: JsonRequest): Promise<string> {
  const maxTokens = req.maxTokens ?? 6000;
  switch (provider) {
    case "anthropic": {
      try {
        const client = new Anthropic({ timeout: CALL_TIMEOUT_MS });
        const response = await client.messages.create({ model, max_tokens: Math.max(maxTokens, 8000), system: req.system, messages: [{ role: "user", content: req.user }] });
        if (response.stop_reason === "refusal") throw new ProviderError("declined the request", REST.badAnswer);
        return response.content.find((b) => b.type === "text")?.text ?? "";
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (error instanceof Anthropic.RateLimitError) throw new ProviderError("rate limited", REST.rateLimited);
        if (error instanceof Anthropic.AuthenticationError) throw new ProviderError("key rejected", REST.badKey);
        if (error instanceof Anthropic.NotFoundError) throw new ProviderError(`model not available (${error.message})`, REST.badModel, true);
        if (error instanceof Anthropic.APIError) throw classify(error.status ?? 500, error.message, null);
        throw new ProviderError(error instanceof Error ? error.message : String(error), REST.outage);
      }
    }
    case "groq": {
      const data = await postJson<OpenAiStyle>(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, max_tokens: maxTokens, temperature: 0.3, response_format: { type: "json_object" }, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] },
        { authorization: `Bearer ${process.env.GROQ_API_KEY!.trim()}` },
      );
      return asText(data.choices?.[0]?.message?.content);
    }
    case "openrouter": {
      const data = await postJson<OpenAiStyle>(
        "https://openrouter.ai/api/v1/chat/completions",
        { model, max_tokens: maxTokens, temperature: 0.3, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] },
        { authorization: `Bearer ${process.env.OPENROUTER_API_KEY!.trim()}`, "http-referer": "https://applya.co.uk", "x-title": "Applya" },
      );
      return asText(data.choices?.[0]?.message?.content);
    }
    case "gemini": {
      const data = await postJson<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
        },
        { "x-goog-api-key": process.env.GEMINI_API_KEY!.trim() },
      );
      return asText(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(""));
    }
    case "cloudflare": {
      const data = await postJson<{ result?: { response?: unknown } }>(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID!.trim()}/ai/run/${model}`,
        { max_tokens: maxTokens, temperature: 0.3, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] },
        { authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN!.trim()}` },
      );
      return asText(data.result?.response);
    }
  }
}

async function states() {
  const rows = await db.aiProviderState.findMany();
  return new Map(rows.map((r) => [r.provider as Provider, r]));
}

async function rest(provider: Provider, error: ProviderError) {
  await db.aiProviderState.upsert({
    where: { provider },
    create: { provider, cooldownUntil: new Date(Date.now() + error.restMs), lastError: error.message.slice(0, 300), failures: 1 },
    update: { cooldownUntil: error.restMs > 0 ? new Date(Date.now() + error.restMs) : null, lastError: error.message.slice(0, 300), failures: { increment: 1 } },
  });
}

async function used(provider: Provider) {
  await db.aiProviderState.upsert({
    where: { provider },
    create: { provider, lastUsedAt: new Date(), calls: 1 },
    update: { lastUsedAt: new Date(), calls: { increment: 1 }, cooldownUntil: null, lastError: null },
  });
}

/**
 * Asks for a JSON object and returns it parsed, trying each configured
 * provider in turn until one answers. Throws only when every provider
 * failed or is resting, or the time budget ran out.
 */
export async function generateJson<T = unknown>(req: JsonRequest): Promise<JsonResult<T>> {
  const queue = providerQueue();
  if (queue.length === 0) throw new Error("No AI provider is configured");
  const deadline = Date.now() + (req.budgetMs ?? 60_000);
  const state = await states();
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const provider of queue) {
    if (Date.now() > deadline - 3_000) {
      skipped.push("time ran out");
      break;
    }
    const until = state.get(provider)?.cooldownUntil?.getTime() ?? 0;
    if (until > Date.now()) {
      skipped.push(`${provider} resting until ${new Date(until).toISOString().slice(11, 16)} UTC`);
      continue;
    }
    // A model the provider no longer offers is swapped for the next candidate, twice at most.
    const tried = new Set<string>();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const model = await modelFor(provider, { refresh: attempt > 0, exclude: tried });
      if (tried.has(model)) break;
      tried.add(model);
      try {
        const text = await callProvider(provider, model, req);
        if (!text.trim()) throw new ProviderError("returned nothing", REST.badAnswer);
        let data: T;
        try {
          data = JSON.parse(extractJson(text)) as T;
        } catch {
          throw new ProviderError("did not return valid JSON", REST.badAnswer);
        }
        await used(provider);
        return { data, provider, model };
      } catch (error) {
        const pe = error instanceof ProviderError ? error : new ProviderError(error instanceof Error ? error.message : String(error), REST.outage);
        console.warn(`[llm] ${provider}/${model}: ${pe.message}`);
        if (pe.modelNotFound && attempt < 2 && Date.now() < deadline - 5_000) continue;
        failed.push(`${provider}: ${pe.message}`);
        await rest(provider, pe);
        break;
      }
    }
  }
  throw new Error(`Every AI provider failed or is resting. ${[...failed, ...skipped].join("; ")}`);
}

/** For the admin page: each provider, whether it has a key, and how it is doing. */
export async function providerReport() {
  const state = await states();
  const queue = providerQueue();
  return ALL_PROVIDERS.map((p) => {
    const s = state.get(p);
    const resting = s?.cooldownUntil && s.cooldownUntil.getTime() > Date.now() ? s.cooldownUntil : null;
    const override = process.env[MODEL_ENV[p]]?.trim();
    return {
      provider: p,
      label: PROVIDER_LABELS[p],
      configured: isConfigured(p),
      position: queue.indexOf(p) + 1,
      model: override || s?.model || (p === "anthropic" ? FALLBACK_MODELS.anthropic : "chosen from the provider's list on first use"),
      resting,
      lastError: s?.lastError ?? null,
      calls: s?.calls ?? 0,
      failures: s?.failures ?? 0,
      lastUsedAt: s?.lastUsedAt ?? null,
    };
  });
}

/** Admin: forget the resting state and cached models so every provider is tried afresh. */
export async function resetProviders() {
  await db.aiProviderState.updateMany({ data: { cooldownUntil: null, lastError: null, model: null, modelCheckedAt: null } });
}
