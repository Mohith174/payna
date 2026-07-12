import OpenAI from "openai";
import { config } from "../config.js";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: config.LLM_BASE_URL,
      apiKey: config.LLM_API_KEY,
      // Large reasoning models on the NVIDIA endpoint can take a while.
      timeout: 120_000,
      // The pipeline owns retry (with attempt logging); the SDK must not retry silently.
      maxRetries: 0,
    });
  }
  return client;
}

const SYSTEM_PROMPT = `You are a regulatory filing analyst. You extract structured filing requirements from regulatory documents.

Respond with ONLY a JSON array (no prose, no markdown fences). Each element must be an object with EXACTLY these fields:
- "name": string — short requirement name, e.g. "Annual Report"
- "description": string — one-sentence description of the filing
- "stateCode": string — two-letter US state code, e.g. "TX"
- "licenseTypeName": string — the license the requirement applies to, e.g. "Money Transmitter License"
- "intervalMonths": integer or null — renewal cadence in months (12 = annual, 3 = quarterly); null if not recurring
- "dueMonthDay": string or null — fixed due date as "MM-DD" (zero-padded), null if none stated
- "formNumber": string — omit the field entirely if not stated
- "agency": string — omit the field entirely if not stated
- "dependsOnNames": array of strings — names of other requirements this one depends on (empty array if none)
- "confidence": number between 0 and 1 — your confidence in this record

Extract only requirements actually described in the document. Do not invent filings. If the document describes no filing requirements, respond with [].`;

export function buildMessages(documentText: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Extract the filing requirements from this document:\n\n${documentText}` },
  ];
}

/** One LLM round-trip. Throws OpenAI SDK errors untouched — the pipeline classifies them. */
export async function callLlm(documentText: string): Promise<string> {
  const completion = await getClient().chat.completions.create({
    model: config.LLM_MODEL,
    messages: buildMessages(documentText),
    temperature: 0,
    max_tokens: 4096,
  });
  return completion.choices[0]?.message?.content ?? "";
}

/** Retry only on 429 / 5xx / network errors; 4xx auth/validation errors are permanent. */
export function isRetryableLlmError(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionError || err instanceof OpenAI.APIConnectionTimeoutError) return true;
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    return status === 429 || (typeof status === "number" && status >= 500);
  }
  return false;
}
