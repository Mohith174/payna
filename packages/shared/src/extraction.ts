import { z } from "zod";

// Structured output schema for the LLM extraction pipeline (docs/SPEC.md §5).
// Types/schema only here — the extraction runtime is Phase 2.
export const ExtractedRequirementSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  stateCode: z.string().length(2),
  licenseTypeName: z.string().min(1),
  intervalMonths: z.number().int().positive().nullable(),
  dueMonthDay: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .nullable(),
  formNumber: z.string().optional(),
  agency: z.string().optional(),
  dependsOnNames: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type ExtractedRequirement = z.infer<typeof ExtractedRequirementSchema>;
