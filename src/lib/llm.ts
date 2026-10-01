import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";

// One place that asks a language model for JSON. Every provider with a key
// is in the queue; a call goes to the first one that is not resting, and
// when a provider answers with a rate limit, exhausted quota, an outage or
// nonsense, it is rested for a while and the next provider takes over. Free
// tiers come first, Anthropic last as the paid backstop. AI_PROVIDER can be
// one name or a comma-separated order.

export type Provider = "groq" | "gemini" | "openrouter" | "cloudflare" | "anthropic";

export const ALL_PROVIDERS: Provider[] = ["groq", "gemini", "openrouter", "cloudflare", "anthropic"];

const DEFAULT_MODELS: Record<Provider, string> = {
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-2.5-flash",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
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

export function modelFor(p: Provider) {
  return process.env[MODEL_ENV[p]]?.trim() || (p === "anthropic" ? process.env.TAILOR_MODEL?.trim() : "") || DEFAULT_MODELS[p];
}

export interface JsonRequest {
  system: string;
  user: string;
  maxTokens?: number;
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
};

class ProviderError extends Error {
  constructor(
    message: string,
    public restMs: number,
  ) {
    super(message);
  }
}

/** Turns an HTTP failure into how long to rest the provider. */
function classify(status: number, body: string, retryAfter: string | null): ProviderError {
  const detail = body.slice(0, 200).replace(/\s+/g, " ");
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
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  } catch (error) {
    throw new ProviderError(`unreachable (${error instanceof Error ? error.message : String(error)})`, REST.outage);
  }
  if (!res.ok) throw classify(res.status, await res.text(), res.headers.get("retry-after"));
  return (await res.json()) as T;
}

interface OpenAiStyle {
  choices?: { message?: { content?: string } }[];
}

async function callProvider(provider: Provider, model: string, req: JsonRequest): Promise<string> {
  const maxTokens = req.maxTokens ?? 6000;
  switch (provider) {
    case "anthropic": {
      try {
        const client = new Anthropic();
        const response = await client.messages.create({ model, max_tokens: Math.max(maxTokens, 8000), system: req.system, messages: [{ role: "user", content: req.user }] });
        if (response.stop_reason === "refusal") throw new ProviderError("declined the request", REST.badAnswer);
        return response.content.find((b) => b.type === "text")?.text ?? "";
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (error instanceof Anthropic.RateLimitError) throw new ProviderError("rate limited", REST.rateLimited);
        if (error instanceof Anthropic.AuthenticationError) throw new ProviderError("key rejected", REST.badKey);
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
      return data.choices?.[0]?.message?.content ?? "";
    }
    case "openrouter": {
      const data = await postJson<OpenAiStyle>(
        "https://openrouter.ai/api/v1/chat/completions",
        { model, max_tokens: maxTokens, temperature: 0.3, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] },
        { authorization: `Bearer ${process.env.OPENROUTER_API_KEY!.trim()}`, "http-referer": "https://applya.co.uk", "x-title": "Applya" },
      );
      return data.choices?.[0]?.message?.content ?? "";
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
      return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    }
    case "cloudflare": {
      const data = await postJson<{ result?: { response?: string } }>(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID!.trim()}/ai/run/${model}`,
        { max_tokens: maxTokens, temperature: 0.3, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] },
        { authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN!.trim()}` },
      );
      return data.result?.response ?? "";
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
    update: { cooldownUntil: new Date(Date.now() + error.restMs), lastError: error.message.slice(0, 300), failures: { increment: 1 } },
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
 * failed or is resting.
 */
export async function generateJson<T = unknown>(req: JsonRequest): Promise<JsonResult<T>> {
  const queue = providerQueue();
  if (queue.length === 0) throw new Error("No AI provider is configured");
  const state = await states();
  const now = Date.now();
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const provider of queue) {
    const until = state.get(provider)?.cooldownUntil?.getTime() ?? 0;
    if (until > now) {
      skipped.push(`${provider} resting until ${new Date(until).toISOString().slice(11, 16)} UTC`);
      continue;
    }
    const model = modelFor(provider);
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
      console.warn(`[llm] ${provider} ${pe.message}; trying the next provider`);
      failed.push(`${provider}: ${pe.message}`);
      await rest(provider, pe);
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
    return { provider: p, label: PROVIDER_LABELS[p], configured: isConfigured(p), position: queue.indexOf(p) + 1, model: modelFor(p), resting, lastError: s?.lastError ?? null, calls: s?.calls ?? 0, failures: s?.failures ?? 0, lastUsedAt: s?.lastUsedAt ?? null };
  });
}
