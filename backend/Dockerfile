# =============================================================================
# IR-Sauron — Backend Dockerfile (FastAPI / Python 3.12)
# Multi-stage: builder → production → development
# =============================================================================

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM python:3.12-slim AS production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    # Непривилегированный пользователь
    && groupadd -r irt && useradd -r -g irt -d /app irt

COPY --from=builder /install /usr/local
COPY --chown=irt:irt . .

USER irt

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD curl -sf http://localhost:8000/health || exit 1

# 4 worker'а; настройте через GUNICORN_WORKERS при deploy
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "4", \
     "--log-level", "info", \
     "--access-log"]

# ── Stage 3: development (hot-reload, dev-deps) ───────────────────────────────
FROM python:3.12-slim AS development

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-dev.txt* ./
RUN pip install --no-cache-dir -r requirements.txt \
    && ([ -f requirements-dev.txt ] && pip install --no-cache-dir -r requirements-dev.txt || true)

EXPOSE 8000

CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--reload", \
     "--log-level", "debug"]
