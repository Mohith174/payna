// Defensive parsing of LLM output: reasoning models may emit
// <think> blocks, prose preamble, or markdown fences around the JSON. We strip
// reasoning tags, then scan for the first structurally balanced JSON array and
// parse only that.

export class UnparseableResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnparseableResponseError";
  }
}

function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((el) => typeof el === "object" && el !== null && !Array.isArray(el));
}

/**
 * Extract and parse the first JSON array of objects in the text. Bracket
 * matching is string-aware (quotes/escapes) so a "[" inside a string value
 * can't truncate the scan; prose citations like "[1]" are skipped because
 * their elements aren't objects. An empty array is accepted (no requirements
 * found is a valid extraction result).
 */
export function extractFirstJsonArray(raw: string): Record<string, unknown>[] {
  const text = stripReasoning(raw);

  for (let start = text.indexOf("["); start !== -1; start = text.indexOf("[", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        if (inString) escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            const parsed: unknown = JSON.parse(candidate);
            if (isRecordArray(parsed)) return parsed;
          } catch {
            // Balanced but not valid JSON (e.g. a prose bracket) — try the next "[".
          }
          break;
        }
      }
    }
  }

  throw new UnparseableResponseError("No parseable JSON array found in LLM response");
}
