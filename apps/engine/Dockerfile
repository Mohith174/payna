# Payna engine — Python multi-agent compliance engine.
FROM python:3.13-slim

WORKDIR /app

# System deps kept minimal; psycopg[binary] and neo4j ship wheels.
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY apps/engine/pyproject.toml ./pyproject.toml
COPY apps/engine/payna_engine ./payna_engine
COPY apps/engine/evals ./evals

RUN pip install --upgrade pip && pip install -e .

EXPOSE 4100

# Runs the FastAPI app; the workflow spawns the MCP server as a child process.
CMD ["python", "-m", "payna_engine.api"]
