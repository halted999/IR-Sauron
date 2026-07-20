# =============================================================================
# IR Timeline Constructor — Makefile
# =============================================================================

COMPOSE      = docker compose --env-file .env
COMPOSE_DEV  = $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_SSO  = $(COMPOSE) --profile sso

.PHONY: help up down dev dev-down sso logs ps \
        build build-dev shell-back shell-db \
        migrate seed backup restore \
        cert-gen lint

help: ## Показать список команд
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Запуск ───────────────────────────────────────────────────────────────────

up: .env ## Запуск production-стека
	$(COMPOSE) up -d

down: ## Остановка production-стека
	$(COMPOSE) down

dev: .env ## Запуск dev-стека с hot-reload
	$(COMPOSE_DEV) up -d

dev-down: ## Остановка dev-стека
	$(COMPOSE_DEV) down

sso: .env ## Запуск с Keycloak SSO
	$(COMPOSE_SSO) up -d

# ── Build ────────────────────────────────────────────────────────────────────

build: ## Пересборка production-образов
	$(COMPOSE) build --no-cache

build-dev: ## Пересборка dev-образов
	$(COMPOSE_DEV) build --no-cache

# ── Логи и статус ────────────────────────────────────────────────────────────

logs: ## Хвост логов всех сервисов
	$(COMPOSE) logs -f --tail=100

ps: ## Статус контейнеров
	$(COMPOSE) ps

# ── Shells ───────────────────────────────────────────────────────────────────

shell-back: ## Shell в backend-контейнере
	$(COMPOSE) exec backend /bin/sh

shell-db: ## psql в postgres-контейнере
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER} -d $${POSTGRES_DB}

# ── DB migrations ────────────────────────────────────────────────────────────

migrate: ## Применить Alembic-миграции
	$(COMPOSE) exec backend alembic upgrade head

seed: ## Загрузить тестовые данные (только dev)
	$(COMPOSE_DEV) exec backend python -m app.seed

# ── Backup / Restore ─────────────────────────────────────────────────────────

backup: ## Дамп PostgreSQL → backups/
	@mkdir -p backups
	$(COMPOSE) exec -T postgres pg_dump \
	  -U $${POSTGRES_USER} $${POSTGRES_DB} \
	  | gzip > backups/pg_$$(date +%Y%m%d_%H%M%S).sql.gz
	@echo "Backup saved to backups/"

restore: ## Восстановление из дампа: make restore FILE=backups/pg_xxx.sql.gz
	@test -n "$(FILE)" || (echo "Usage: make restore FILE=<path>"; exit 1)
	gunzip -c $(FILE) | $(COMPOSE) exec -T postgres psql \
	  -U $${POSTGRES_USER} -d $${POSTGRES_DB}

# ── TLS сертификаты (самоподписанные для dev) ─────────────────────────────────

cert-gen: ## Сгенерировать self-signed сертификат для dev
	@mkdir -p nginx/ssl
	openssl req -x509 -nodes -newkey rsa:4096 \
	  -keyout nginx/ssl/key.pem \
	  -out    nginx/ssl/cert.pem \
	  -days   365 \
	  -subj "/CN=irt.local/O=IR-Timeline/C=RU"
	@echo "Certificates written to nginx/ssl/"

# ── Проверка конфига ─────────────────────────────────────────────────────────

lint: ## Проверить nginx.conf
	$(COMPOSE) exec nginx nginx -t

# ── Инициализация .env ───────────────────────────────────────────────────────

.env:
	@echo "Файл .env не найден. Создаю из .env.example..."
	cp .env.example .env
	@echo "Откройте .env и замените все значения CHANGE_ME перед запуском!"
	@exit 1
