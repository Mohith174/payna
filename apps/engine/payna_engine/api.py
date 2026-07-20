"""FastAPI surface for the engine.

Mounts everything under /api so the React dashboard can point at this service
the same way it points at the TS server. The extraction route drives the full
LangGraph workflow; the graph and obligation routes read the Neo4j context graph.
"""

from __future__ import annotations

import io
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader

from payna_engine.agents.workflow import run_workflow
from payna_engine.config import get_settings
from payna_engine.db.neo4j_db import get_driver
from payna_engine.db.postgres_db import ensure_schema
from payna_engine.graph.traversal import obligations_single_query
from payna_engine.graph.viz import full_graph


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_schema()
    yield


app = FastAPI(title="Payna Engine", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TextBody(BaseModel):
    text: str


@app.get("/api/health")
async def health() -> dict:
    s = get_settings()
    return {"status": "ok", "mock": s.use_mock, "model": s.llm_model}


@app.post("/api/extractions")
async def extract(body: TextBody | None = None, file: UploadFile | None = File(default=None)) -> dict:
    if file is not None:
        if file.content_type != "application/pdf":
            raise HTTPException(400, "Uploaded file must be a PDF")
        reader = PdfReader(io.BytesIO(await file.read()))
        text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
        name = file.filename or "upload.pdf"
        if not text:
            raise HTTPException(400, "PDF contained no extractable text")
    elif body is not None and body.text.strip():
        text, name = body.text, "inline-text"
    else:
        raise HTTPException(400, "Provide `text` or a PDF `file`")

    result = await run_workflow(name, text)
    return {
        "document": name,
        "accepted": result.get("accepted", []),
        "rejected": result.get("rejected", []),
        "upserted": result.get("upserted", 0),
        "obligationsComputed": len(result.get("obligations", [])),
        "error": result.get("error"),
    }


@app.get("/api/entities")
async def entities() -> list[dict]:
    with get_driver().session() as session:
        rows = session.run("MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.kind AS kind ORDER BY e.name")
        return [r.data() for r in rows]


@app.get("/api/entities/{entity_id}/obligations")
async def entity_obligations(entity_id: str) -> list[dict]:
    return [o.model_dump() for o in obligations_single_query(get_driver(), entity_id)]


@app.get("/api/graph")
async def graph(limit: int = 600) -> dict:
    return full_graph(get_driver(), limit=limit)


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=get_settings().engine_port)


if __name__ == "__main__":
    main()
