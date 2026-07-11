import { Router } from "express";
import multer from "multer";
import { z } from "zod";
// pdf-parse's index.js runs demo code when imported as an ESM entry; import the
// implementation module directly to avoid it.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { getPool } from "../db/postgres.js";
import { ApiError } from "../middleware/error.js";
import { ExtractionFailedError, ExtractionUnconfiguredError, runExtraction } from "../extraction/pipeline.js";

export const extractionsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const TextBodySchema = z.object({ text: z.string().min(1) });

extractionsRouter.post("/", upload.single("file"), async (req, res, next) => {
  try {
    let documentName: string;
    let text: string;

    if (req.file) {
      if (req.file.mimetype !== "application/pdf") {
        throw new ApiError(400, "validation_error", "Uploaded file must be a PDF");
      }
      documentName = req.file.originalname;
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text.trim();
      if (text.length === 0) {
        throw new ApiError(400, "validation_error", "PDF contained no extractable text");
      }
    } else {
      const body = TextBodySchema.parse(req.body);
      documentName = "inline-text";
      text = body.text;
    }

    const result = await runExtraction(documentName, text);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ExtractionUnconfiguredError) {
      next(new ApiError(503, "extraction_unconfigured", err.message));
      return;
    }
    if (err instanceof ExtractionFailedError) {
      next(new ApiError(502, "extraction_failed", err.message));
      return;
    }
    next(err);
  }
});

extractionsRouter.get("/", async (_req, res, next) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id, document_name, status, model, attempt_no, created_at,
              jsonb_array_length(coalesce(validated->'accepted', '[]'::jsonb)) AS accepted,
              jsonb_array_length(coalesce(validated->'rejected', '[]'::jsonb)) AS rejected
       FROM extraction_attempts
       ORDER BY id DESC
       LIMIT 50`,
    );
    res.json(
      rows.map((r) => ({
        id: Number(r.id),
        documentName: r.document_name,
        status: r.status,
        model: r.model,
        attemptNo: r.attempt_no,
        accepted: r.accepted,
        rejected: r.rejected,
        createdAt: r.created_at,
      })),
    );
  } catch (err) {
    next(err);
  }
});
