-- =============================================================================
-- IR Timeline Constructor — database schema
-- Требования: раздел 5.1 ТЗ
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Схема для Keycloak (если используется SSO-профиль)
CREATE SCHEMA IF NOT EXISTS keycloak;

-- ── Enum types ───────────────────────────────────────────────────────────────

CREATE TYPE case_status AS ENUM (
    'open',          -- Открыто (не начато)
    'active',        -- Активное расследование
    'review',        -- На проверке
    'closed'         -- Закрыто
);

CREATE TYPE case_severity AS ENUM (
    'critical', 'high', 'medium', 'low', 'informational'
);

CREATE TYPE branch_status AS ENUM (
    'hypothesis',   -- Гипотеза в проверке (раздел 3.3.2)
    'confirmed',    -- Подтверждена и объединена с основной
    'rejected'      -- Отклонена (сохраняется в архиве дела, раздел 3.3.5)
);

CREATE TYPE event_type AS ENUM (
    'attacker_action',  -- Действие атакующего
    'detection',        -- Обнаружение
    'ir_action',        -- Действие команды реагирования
    'inference',        -- Вывод/гипотеза следователя
    'legal_event'       -- Юридически значимое событие (уведомление регулятора и т.п.)
);

CREATE TYPE confidence_level AS ENUM (
    'confirmed',      -- Подтверждено артефактом
    'corroborated',   -- Косвенно подтверждено
    'hypothesis'      -- Гипотеза следователя (визуально помечается, раздел 3.2.1)
);

CREATE TYPE comment_visibility AS ENUM (
    'internal',  -- Внутренний (не попадает в экспортируемый отчёт, раздел 3.4.5)
    'report'     -- Для отчёта
);

CREATE TYPE user_role AS ENUM (
    'admin',                -- Управление системой, без правки содержания дел
    'ir_lead',              -- Полное управление делом, слияние веток
    'investigator',         -- Добавление фактов, артефактов, веток
    'threat_hunter',        -- Добавление фактов и IOC
    'observer',             -- Только просмотр (руководство)
    'legal',                -- Просмотр отчёта и юридически значимых событий
    'external_contractor'   -- Ограниченный доступ к назначенному делу
);

-- ── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE users (
    id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(255) NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    full_name     VARCHAR(255),
    role          user_role    NOT NULL DEFAULT 'observer',
    is_active     BOOLEAN      NOT NULL DEFAULT true,
    -- SSO/OIDC subject ID (раздел 3.7.3)
    external_id   VARCHAR(255),
    mfa_enabled   BOOLEAN      NOT NULL DEFAULT false,
    -- Хранить хэш пароля только для локальной аутентификации
    password_hash TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Cases ─────────────────────────────────────────────────────────────────────

CREATE TABLE cases (
    id                       UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_number              VARCHAR(50)  NOT NULL UNIQUE,          -- Номер дела (3.1.2)
    title                    VARCHAR(500) NOT NULL,
    status                   case_status  NOT NULL DEFAULT 'open',
    severity                 case_severity NOT NULL DEFAULT 'medium',
    ir_lead_id               UUID         REFERENCES users(id),
    -- Классификация по типу атаки и MITRE ATT&CK (3.1.2)
    attack_classification    VARCHAR(255),
    mitre_groups             TEXT[],
    -- Временные метки жизненного цикла
    incident_discovered_at   TIMESTAMPTZ,                           -- Момент обнаружения инцидента
    investigation_opened_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),   -- Открытие расследования
    investigation_closed_at  TIMESTAMPTZ,
    -- Конфиденциальность (3.1.2)
    confidentiality_label    VARCHAR(50)  NOT NULL DEFAULT 'CONFIDENTIAL',
    -- Интеграция с тикет-системами (3.9.4)
    external_ticket_id       VARCHAR(255),
    external_ticket_system   VARCHAR(50),                           -- jira / servicenow
    -- Итоги расследования (3.1.4)
    root_cause               TEXT,
    impact_summary           TEXT,
    attribution              TEXT,
    recommendations          TEXT,
    -- Повторное открытие закрытого дела (3.1.6)
    reopen_reason            TEXT,
    created_by               UUID         REFERENCES users(id),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Участники расследования с ролями на уровне дела (3.7.2)
CREATE TABLE case_participants (
    case_id    UUID       NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id    UUID       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       user_role  NOT NULL,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by   UUID       REFERENCES users(id),
    PRIMARY KEY (case_id, user_id)
);

-- ── Branches (ветки / гипотезы) ──────────────────────────────────────────────

CREATE TABLE branches (
    id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id               UUID          NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    parent_branch_id      UUID          REFERENCES branches(id),
    -- Точка ветвления (событие в родительской ветке, раздел 3.3.1)
    branch_point_event_id UUID,         -- FK добавляется ниже
    name                  VARCHAR(500)  NOT NULL,
    description           TEXT,
    status                branch_status NOT NULL DEFAULT 'hypothesis',
    -- Обоснование статуса (при отклонении — обязательно, раздел 3.3.2)
    status_reason         TEXT,
    owner_id              UUID          REFERENCES users(id),
    is_main               BOOLEAN       NOT NULL DEFAULT false,     -- Основная хронология
    created_by            UUID          REFERENCES users(id),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Events (факты тайлайна) ───────────────────────────────────────────────────

CREATE TABLE events (
    id                  UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id           UUID              NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    -- Временна́я метка: оригинал источника + нормализованный UTC (раздел 3.2.1)
    event_ts            TIMESTAMPTZ       NOT NULL,
    event_ts_tz_offset  SMALLINT,         -- UTC offset источника, минуты
    event_ts_utc        TIMESTAMPTZ       GENERATED ALWAYS AS (event_ts AT TIME ZONE 'UTC') STORED,
    event_type          event_type        NOT NULL,
    title               VARCHAR(1000)     NOT NULL,
    description         TEXT,
    source_description  TEXT,             -- Описание источника факта
    confidence_level    confidence_level  NOT NULL DEFAULT 'hypothesis',
    -- MITRE ATT&CK (раздел 3.2.1)
    mitre_tactic        VARCHAR(100),
    mitre_technique     VARCHAR(50),      -- T1566 и т.п.
    mitre_subtechnique  VARCHAR(60),      -- T1566.001 и т.п.
    -- Ответственный (раздел 3.5.2)
    owner_id            UUID              REFERENCES users(id),
    -- Мягкое удаление (раздел 3.2.3)
    is_deleted          BOOLEAN           NOT NULL DEFAULT false,
    delete_reason       TEXT,
    deleted_by          UUID              REFERENCES users(id),
    deleted_at          TIMESTAMPTZ,
    -- Порядок отображения (drag-and-drop, раздел 3.2.5)
    sort_order          INTEGER,
    -- Версионность (раздел 3.2.2)
    version             INTEGER           NOT NULL DEFAULT 1,
    created_by          UUID              NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- Замыкаем FK ветки на событие (точка ветвления)
ALTER TABLE branches
    ADD CONSTRAINT fk_branch_point_event
    FOREIGN KEY (branch_point_event_id) REFERENCES events(id);

-- ── Event version history (иммутабельная история, раздел 3.2.2) ───────────────

CREATE TABLE event_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id    UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    version     INTEGER     NOT NULL,
    changed_by  UUID        NOT NULL REFERENCES users(id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- diff в формате {field: {old: ..., new: ...}}
    changes     JSONB       NOT NULL,
    -- Полный снимок события на момент изменения (для полноты chain of custody)
    snapshot    JSONB       NOT NULL,
    UNIQUE (event_id, version)
);

-- ── Causal links (причинно-следственные связи между фактами, раздел 3.2.6) ────

CREATE TABLE event_links (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_event_id UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    target_event_id UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    link_type       VARCHAR(100) NOT NULL DEFAULT 'causes',
    description     TEXT,
    created_by      UUID        REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_event_id, target_event_id),
    CHECK (source_event_id <> target_event_id)
);

-- ── IOC (индикаторы компрометации, раздел 3.2.1) ─────────────────────────────

CREATE TABLE iocs (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id         UUID        NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    ioc_type        VARCHAR(50) NOT NULL,   -- hash_md5, hash_sha256, ip, domain, url, email, filename
    value           TEXT        NOT NULL,
    context         TEXT,
    -- Обогащение из Threat Intelligence платформ (раздел 3.9.3)
    ti_enrichment   JSONB,
    ti_updated_at   TIMESTAMPTZ,
    created_by      UUID        REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE event_iocs (
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    ioc_id   UUID NOT NULL REFERENCES iocs(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, ioc_id)
);

-- ── Artifacts / Evidence (раздел 3.2.4, 5.2) ─────────────────────────────────

CREATE TABLE artifacts (
    id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id              UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    file_name             VARCHAR(1000) NOT NULL,
    file_type             VARCHAR(100),
    file_size             BIGINT,
    storage_path          TEXT        NOT NULL,   -- Путь в MinIO
    sha256                VARCHAR(64) NOT NULL,   -- Хэш при загрузке (раздел 4.3)
    md5                   VARCHAR(32),
    -- Chain of custody: откуда и как получен артефакт (раздел 2, термины)
    upload_source         TEXT,
    -- WORM-режим для критических доказательств (раздел 5.2)
    is_worm               BOOLEAN     NOT NULL DEFAULT false,
    uploaded_by           UUID        NOT NULL REFERENCES users(id),
    uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Периодическая проверка целостности (раздел 4.3)
    integrity_verified_at TIMESTAMPTZ,
    integrity_ok          BOOLEAN
);

-- ── Comments (раздел 3.4) ─────────────────────────────────────────────────────

CREATE TABLE comments (
    id                UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Комментарий может быть к факту или к ветке в целом
    event_id          UUID                REFERENCES events(id) ON DELETE CASCADE,
    branch_id         UUID                REFERENCES branches(id) ON DELETE CASCADE,
    parent_comment_id UUID                REFERENCES comments(id),   -- Тред (раздел 3.4.2)
    author_id         UUID                NOT NULL REFERENCES users(id),
    body              TEXT                NOT NULL,
    visibility        comment_visibility  NOT NULL DEFAULT 'internal',
    -- Отметка «решено» (раздел 3.4.4)
    is_resolved       BOOLEAN             NOT NULL DEFAULT false,
    resolved_by       UUID                REFERENCES users(id),
    resolved_at       TIMESTAMPTZ,
    -- Мягкое удаление (раздел 3.4.6 — полная история без возможности «чистого» удаления)
    is_deleted        BOOLEAN             NOT NULL DEFAULT false,
    deleted_by        UUID                REFERENCES users(id),
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_comment_parent CHECK (
        (event_id IS NOT NULL AND branch_id IS NULL) OR
        (event_id IS NULL AND branch_id IS NOT NULL)
    )
);

-- История редактирования/удаления комментариев (раздел 3.4.6)
CREATE TABLE comment_history (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    comment_id  UUID        NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    body_before TEXT        NOT NULL,
    changed_by  UUID        NOT NULL REFERENCES users(id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    action      VARCHAR(20) NOT NULL   -- 'edit' | 'delete'
);

-- ── Audit log (иммутабельный журнал, раздел 3.5.3, 4.3) ───────────────────────

CREATE TABLE audit_log (
    id          BIGSERIAL   PRIMARY KEY,
    case_id     UUID        REFERENCES cases(id),
    user_id     UUID        REFERENCES users(id),
    user_agent  TEXT,
    ip_address  INET,
    action      VARCHAR(100) NOT NULL,       -- CREATE_EVENT, MERGE_BRANCH, CLOSE_CASE ...
    object_type VARCHAR(100) NOT NULL,       -- event, branch, case, artifact ...
    object_id   TEXT,
    details     JSONB,
    ts          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Триггер, делающий записи аудита иммутабельными (раздел 4.3)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Audit log is immutable — modification denied';
END;
$$;

CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_events_branch         ON events(branch_id) WHERE is_deleted = false;
CREATE INDEX idx_events_ts_utc         ON events(event_ts_utc);
CREATE INDEX idx_events_type           ON events(event_type);
CREATE INDEX idx_events_confidence     ON events(confidence_level);
CREATE INDEX idx_events_mitre          ON events(mitre_technique);
CREATE INDEX idx_events_owner          ON events(owner_id);

CREATE INDEX idx_branches_case         ON branches(case_id);
CREATE INDEX idx_branches_parent       ON branches(parent_branch_id);
CREATE INDEX idx_branches_status       ON branches(status);

CREATE INDEX idx_cases_status          ON cases(status);
CREATE INDEX idx_cases_ir_lead         ON cases(ir_lead_id);
CREATE INDEX idx_case_participants_uid ON case_participants(user_id);

CREATE INDEX idx_iocs_case             ON iocs(case_id);
CREATE INDEX idx_iocs_value            ON iocs(value);
CREATE INDEX idx_iocs_type             ON iocs(ioc_type);

CREATE INDEX idx_audit_case            ON audit_log(case_id);
CREATE INDEX idx_audit_user            ON audit_log(user_id);
CREATE INDEX idx_audit_ts              ON audit_log(ts);
CREATE INDEX idx_audit_action          ON audit_log(action);

CREATE INDEX idx_comments_event        ON comments(event_id) WHERE is_deleted = false;
CREATE INDEX idx_comments_branch       ON comments(branch_id) WHERE is_deleted = false;

CREATE INDEX idx_artifacts_event       ON artifacts(event_id);
CREATE INDEX idx_artifacts_sha256      ON artifacts(sha256);
