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
RUN pip install --no-cache-dir --timeout 100 --retries 8 --prefix=/install -r requirements.txt

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM python:3.12-slim AS production

WORKDIR /app

# postgresql-client from Debian's own repo tracks whatever PG version ships
# with the current release (e.g. trixie → 17), which can drift ahead of the
# postgres:16 server in docker-compose.yml and break pg_dump/pg_restore
# wire-protocol compatibility (e.g. PG17 dumps set session GUCs PG16 doesn't
# know). Pin the client to the PGDG repo's 16.x build to match the server.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        curl \
        ca-certificates \
        gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
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
        ca-certificates \
        gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-dev.txt* ./
RUN pip install --no-cache-dir --timeout 100 --retries 8 -r requirements.txt \
    && ([ -f requirements-dev.txt ] && pip install --no-cache-dir --timeout 100 --retries 8 -r requirements-dev.txt || true)

EXPOSE 8000

CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--reload", \
     "--log-level", "debug"]
