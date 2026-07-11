import cors from "cors";
import express from "express";
import { errorHandler } from "./middleware/error.js";
import { entitiesRouter } from "./routes/entities.js";
import { extractionsRouter } from "./routes/extractions.js";
import { healthRouter } from "./routes/health.js";

// App construction lives apart from the listener so the same app can be
// served by a long-running process (index.ts, Docker) or exported as a
// serverless handler (/api/index.mjs on Vercel).
export const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/entities", entitiesRouter);
app.use("/api/extractions", extractionsRouter);

app.use(errorHandler);

export default app;
