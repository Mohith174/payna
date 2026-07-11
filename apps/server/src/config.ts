import { z } from "zod";

// Fail fast: an invalid/missing env var should stop the process with a readable
// message, not surface as a cryptic runtime error three layers deep.
const EnvSchema = z.object({
  NEO4J_URI: z.string().min(1, "NEO4J_URI is required"),
  NEO4J_USER: z.string().min(1, "NEO4J_USER is required"),
  NEO4J_PASSWORD: z.string().min(1, "NEO4J_PASSWORD is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  MOCK_EXTRACTION: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  PORT: z
    .string()
    .optional()
    .default("4000")
    .transform((v) => Number(v)),
});

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
export type Config = typeof config;
