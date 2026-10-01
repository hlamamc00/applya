import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// One place that asks a language model for JSON, whichever provider has a
// key. Free tiers first for a start: Groq, Google Gemini, OpenRouter's free
// models and Cloudflare Workers AI; Anthropic when its key is set. Set
// AI_PROVIDER to pick one explicitly; otherwise the first configured
// provider in PROVIDER_ORDER is used.

export type Provider = "anthropic" | "groq" | "gemini" | "openrouter" | "cloudflare";

const PROVIDER_ORDER: Provider[] = ["anthropic", "groq", "gemini", "openrouter", "cloudflare"];

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-opus-5-5",
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-2.5-flash",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  cloudflare: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic Claude",
  groq: "Groq (free tier)",
  gemini: "Google Gemini (free tier)",
  openrouter: "OpenRouter (free models)",
  cloudflare: "Cloudflare Workers AI (free allowance)",
};

function configured(p: Provider) {
  const env = process.env;
  switch (p) {
    case "anthropic":
      return Boolean(env.ANTHROPIC_API_KEY?.trim());
    case "groq":
      return Boolean(env.GROQ_API_KEY?.trim());
    case "gemini":
      return Boolean(env.GEMINI_API_KEY?.trim());
    case "openrouter":
      return Boolean(env.OPENROUTER_API_KEY?.trim());
    case "cloudflare":
      return Boolean(env.CLOUDFLARE_ACCOUNT_ID?.trim() && env.CLOUDFLARE_AI_TOKEN?.trim());
  }
}

/** The provider in use, or null when no key is set. */
export function activeProvider(): Provider | null {
  const chosen = process.env.AI_PROVIDER?.trim().toLowerCase() as Provider | undefined;
  if (chosen && chosen in DEFAULT_MODELS) return configured(chosen) ? chosen : null;
  return PROVIDER_ORDER.find(configured) ?? null;
}

export function aiAvailable() {
  return activeProvider() !== null;
}

export function activeModel() {
  const p = activeProvider();
  if (!p) return null;
  return process.env.AI_MODEL?.trim() || (p === "anthropic" ? process.env.TAILOR_MODEL?.trim() : "") || DEFAULT_MODELS[p];
}

export interface JsonRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

/** Strips code fences and anything around the outermost JSON object. */
function extractJson(text: string) {
  const unfenced = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`${res.status} from ${new URL(url).host}: ${detail}`);
  }
  return (await res.json()) as T;
}

interface OpenAiStyle {
  choices?: { message?: { content?: string } }[];
}

/**
 * Asks the active provider for a JSON object and returns it parsed. The
 * system prompt must say what shape is wanted; the provider is asked for
 * JSON output where it supports that.
 */
export async function generateJson<T = unknown>(req: JsonRequest): Promise<{ data: T; provider: Provider; model: string }> {
  const provider = activeProvider();
  if (!provider) throw new Error("No AI provider is configured");
  const model = activeModel()!;
  const maxTokens = req.maxTokens ?? 6000;
  let text: string;

  switch (provider) {
    case "anthropic": {
      const client = new Anthropic();
      const response = await client.messages.create({ model, max_tokens: Math.max(maxTokens, 8000), system: req.system, messages: [{ role: "user", content: req.user }] });
      if (response.stop_reason === "refusal") throw new Error("The model declined this request");
      text = response.content.find((b) => b.type === "text")?.text ?? "";
      break;
    }
    case "groq": {
      const data = await postJson<OpenAiStyle>(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, max_tokens: maxTokens, temperature: 0.3, response_format: { type: "json_object" }, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] },
        { authorization: `Bearer ${process.env.GROQ_API_KEY!.trim()}` },
      );
      text = data.choices?.[0]?.message?.content ?? "";
      break;
    }
    case "openrouter": {
      const data = await postJson<OpenAiStyle>(
        "https://openrouter.ai/api/v1/chat/completions",
        { model, max_tokens: maxTokens, temperature: 0.3, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] },
        { authorization: `Bearer ${process.env.OPENROUTER_API_KEY!.trim()}`, "http-referer": "https://applya.co.uk", "x-title": "Applya" },
      );
      text = data.choices?.[0]?.message?.content ?? "";
      break;
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
      text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      break;
    }
    case "cloudflare": {
      const data = await postJson<{ result?: { response?: string } }>(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID!.trim()}/ai/run/${model}`,
        { max_tokens: maxTokens, temperature: 0.3, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] },
        { authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN!.trim()}` },
      );
      text = data.result?.response ?? "";
      break;
    }
  }

  if (!text.trim()) throw new Error(`${PROVIDER_LABELS[provider]} returned nothing`);
  try {
    return { data: JSON.parse(extractJson(text)) as T, provider, model };
  } catch {
    throw new Error(`${PROVIDER_LABELS[provider]} did not return valid JSON`);
  }
}
