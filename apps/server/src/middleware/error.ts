import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFound(subject: string): ApiError {
  return new ApiError(404, "not_found", `${subject} not found`);
}

// Central error handler -> {error:{code,message}}.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "validation_error", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
    });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Internal server error" } });
}
