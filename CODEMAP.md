# Карта кода IR-Sauron

Справочник по расположению функциональности в проекте — для быстрой навигации и
поиска (`grep -i "ключевое слово" CODEMAP.md`). Каждая строка: путь к файлу и
одна фраза о его назначении. Актуальность не гарантируется автоматически —
при крупных изменениях структуры стоит обновлять вручную.

## Backend (`backend/app`)

### Точка входа и инфраструктура

- `main.py` — создание FastAPI-приложения, регистрация всех роутеров (`/v1/...`), CORS, lifespan-хуки (запуск планировщиков MITRE/event source), health-check.
- `config.py` — `Settings` (pydantic-settings): переменные окружения (БД, Redis, MinIO, JWT, интервалы синхронизации).
- `database.py` — асинхронный SQLAlchemy engine/session (`get_db` dependency), базовый `DeclarativeBase`.
- `models.py` — все ORM-модели и enum'ы: `User`, `Case`, `Alert`, `Branch`, `Event`, `IOC`, `Artifact`, `Comment`, `AuditLog`, `AppSettings`, `MitreTechnique`, `EventSource`, `AlertRule`, `RolePermission` и связанные enum-типы статусов/ролей.
- `schemas.py` — все Pydantic-схемы запросов/ответов API (Create/Update/Response для каждой сущности из `models.py`).

### `core/` — сквозные механизмы

- `core/auth.py` — JWT access/refresh токены, `get_current_active_user`, хранение сессий в Redis.
- `core/rbac.py` — проверка прав доступа по ролям (`UserRole`) и `RolePermission`.
- `core/crypto.py` — AES-GCM шифрование секретов (пароли event source'ов, API-ключи интеграций).
- `core/audit.py` — запись действий пользователей в `AuditLog`.
- `core/maintenance.py` — режим обслуживания (бэкап/восстановление БД) — блокировка API и прогресс через Redis.

### `api/v1/` — HTTP-эндпоинты (роутеры)

- `api/v1/auth.py` — `/auth`: логин, обновление токена, выход.
- `api/v1/users.py` — `/users`: CRUD пользователей, назначаемые исполнители.
- `api/v1/cases.py` — `/cases`: инциденты (создание, обновление, отчёт, архивация), присоединение/отсоединение одного инцидента к другому (`/attach`, `/detach`).
- `api/v1/branches.py` — ветки timeline внутри инцидента (граф событий), без общего prefix.
- `api/v1/events.py` — события внутри ветки timeline (создание/связи/история версий), без общего prefix.
- `api/v1/artifacts.py` — загрузка/скачивание файловых артефактов (хранение в MinIO), без общего prefix.
- `api/v1/iocs.py` — индикаторы компрометации (IOC), привязанные к инциденту, без общего prefix.
- `api/v1/comments.py` — комментарии к событиям/веткам, без общего prefix.
- `api/v1/alerts.py` — `/alerts`: список, эскалация в инцидент, похожие алерты, bulk-операции (assign/delete/restore/purge).
- `api/v1/alert_rules.py` — `/alert-rules`: автоматические правила обработки входящих алертов (suppress/escalate/assign_tag).
- `api/v1/event_sources.py` — `/event-sources`: настройка внешних источников алертов (Elastic, TheHive, email, file watch, generic JSON API), тест соединения, ручной sync.
- `api/v1/admin.py` — `/admin`: настройки приложения, бэкап/восстановление БД и конфигурации, матрица прав ролей, «Демо-режим» (`/admin/demo-mode/*`: статус/переключатель, сидирование алертов+инцидентов/источников/аудит-лога, полная очистка алертов и инцидентов с фразой подтверждения).
- `api/v1/statistics.py` — `/statistics`: обзорная статистика по алертам (timeline, top IP/аккаунты) и граф корреляций (`/statistics/correlation-graph`) для страницы «Анализ».
- `api/v1/mitre.py` — `/mitre`: матрица MITRE ATT&CK, ручной запуск синхронизации.

### `services/` — бизнес-логика и интеграции

- `services/alert_stats_parsing.py` — извлечение IP/URL/аккаунтов/типа угрозы из произвольного текста алерта (для источников без структурированных данных, напр. TheHive).
- `services/ecs_parsing.py` — то же самое, но из структурированного Elastic ECS-документа (`Alert.raw_event`).
- `services/alert_rules.py` — применение `AlertRule` к входящим алертам (движок правил).
- `services/event_source_scheduler.py` — фоновый планировщик опроса всех `EventSource` (APScheduler), блокировки от параллельного запуска.
- `services/elastic_client.py` — коннектор источника типа Elastic (запросы к Elasticsearch/OpenSearch).
- `services/thehive_client.py` — коннектор источника типа TheHive.
- `services/email_client.py` — коннектор источника типа email (IMAP-опрос почтового ящика).
- `services/file_watch_client.py` — коннектор источника типа file watch (инкрементальное чтение CSV/JSON из папки/шары).
- `services/json_api_client.py` — коннектор источника типа generic JSON API (пагинация, инкрементальный since-фильтр, дедуп по хешу содержимого).
- `services/mitre_attack.py` — статическая карта тактик MITRE ATT&CK → severity/гриф конфиденциальности; читает `mitre_attack_data.json`.
- `services/mitre_attack_data.json` — данные матрицы MITRE ATT&CK Enterprise (STIX-экспорт), technique → tactic.
- `services/mitre_sync.py` — обновление таблицы `mitre_techniques` из официального STIX-бандла MITRE (GitHub).
- `services/mitre_scheduler.py` — фоновый планировщик периодического запуска `mitre_sync`.
- `services/storage.py` — обёртка над MinIO/S3 для хранения артефактов.
- `services/demo_seed.py` — генерация/очистка демо-данных для «Демо-режима»: 80 инцидентов + 500 алертов, равномерно распределённых по 19 техникам MITRE ATT&CK, демо-источники алертов, демо-записи аудит-лога, полная очистка алертов/инцидентов.

### `ws/` — WebSocket

- `ws/manager.py` — менеджер WebSocket-подключений для realtime-обновлений timeline (через Redis pub/sub).

## Frontend (`frontend/src`)

### Страницы (`pages/`) — соответствуют разделам приложения

- `pages/LoginPage.tsx` — страница входа.
- `pages/DashboardPage.tsx` — главная панель: сводная статистика, последние алерты.
- `pages/AlertsPage.tsx` — список алертов с фильтрами, bulk-действиями, эскалацией.
- `pages/AlertDetailPage.tsx` — детальная карточка алерта (описание, похожие алерты, действия).
- `pages/CasePage.tsx` — страница инцидента: timeline/граф событий, IOC, отчёт, участники.
- `pages/AnalysisPage.tsx` — страница «Анализ»: поиск + граф корреляций между алертами и сущностями (обёртка над `CorrelationGraph`).
- `pages/StatisticsPage.tsx` — графики и агрегированная статистика по алертам за период: по статусам/типу угрозы/URL/IP/учёткам/файлам, с текстовым поиском по этим таблицам.
- `pages/MitreAttackPage.tsx` — матрица MITRE ATT&CK с покрытием по инцидентам.
- `pages/AdminPanelPage.tsx` — админка: пользователи, event sources, alert rules, роли, настройки приложения, бэкапы, лог действий, демо-режим (`DemoModeSection`).
- `pages/ProfilePage.tsx` — профиль пользователя, выбор темы оформления.
- `pages/HelpPage.tsx` — страница справки.

### Компоненты (`components/`)

- `components/Layout/AppLayout.tsx` — общий каркас страниц (шапка, навигация, тема).
- `components/Graph/CorrelationGraph.tsx` — интерактивный граф корреляций (страница «Анализ»): чекбокс-фильтры по типам элементов, группировка похожих алертов, утолщение связей в цепочках 3+, клик по узлу открывает `GraphDetailsPanel`.
- `components/Graph/GraphDetailsPanel.tsx` — правая панель деталей графа: описание алерта / таблица упоминаний сущности / список похожих алертов группы с таблицей счётчиков совпадений по типам (IP/учётки/файлы/IOC); клик по алерту в любом списке читает его тут же (инлайн, без ухода со страницы), с кнопкой «Назад к списку».
- `components/Graph/EventGraph.tsx` — граф связей событий внутри ветки timeline на странице инцидента; если инцидент главный (есть присоединённые), дополнительно показывает узлы главной ветки присоединённых инцидентов как read-only (пунктирная рамка, подпись инцидента, нельзя перетаскивать/тянуть связь, клик — переход в дочерний инцидент).
- `components/Analysis/AnalyzeDropdownButton.tsx` — кнопка «Анализировать» (переход в анализатор с предзаполненным значением).
- `components/Alerts/CaseAlertsPanel.tsx` — список алертов, привязанных к инциденту; если есть присоединённые инциденты, дополнительно подтягивает их алерты и показывает столбец «Присоединён» со ссылкой на дочерний инцидент.
- `components/Alerts/SimilarAlertsPanel.tsx` — блок «похожие алерты» на странице алерта.
- `components/Alerts/AlertModal.tsx` — модалка создания/редактирования алерта.
- `components/Alerts/AlertRuleFormModal.tsx` — модалка создания/редактирования правила автообработки алертов; действие (подавить/эскалировать/тег/в архив) выбирается выпадающим списком.
- `components/Alerts/AlertRulesModal.tsx` — модалка списка правил автообработки.
- `components/Alerts/AssignUserModal.tsx` — модалка назначения исполнителя алерту.
- `components/Cases/CaseModal.tsx` — модалка создания/редактирования инцидента.
- `components/Cases/AttachCaseModal.tsx` — модалка кнопки «Присоединить»: поиск другого инцидента, выбор главного, причина присоединения.
- `components/Cases/AttachedIncidentsPanel.tsx` — подраздел «Инциденты» на карточке инцидента (виден только если инцидент присоединён/имеет присоединённые): главный инцидент или список присоединённых, кнопка «Отсоединить».
- `components/Cases/AssignLeadDropdown.tsx` — кнопка «Назначить» с выпадающим списком пользователей на карточке инцидента (первая строка — «Назначить на себя»), задаёт `Case.ir_lead_id`.
- `components/Cases/CaseReportPanel.tsx` — формирование и экспорт отчёта по инциденту (PDF через jsPDF/html2canvas).
- `components/Cases/IOCPanel.tsx` — список и добавление IOC инцидента.
- `components/Events/EventDetail.tsx` — детальная карточка события timeline.
- `components/Events/EventModal.tsx` — модалка создания/редактирования события.
- `components/Comments/CommentList.tsx` — список комментариев к событию/ветке.
- `components/Admin/EventSourceFormModal.tsx` — форма настройки источника алертов (все типы: elastic/thehive/email/file_watch/json_api).
- `components/Admin/UserFormModal.tsx` — форма создания/редактирования пользователя.
- `components/Maintenance/MaintenancePage.tsx` — экран режима обслуживания (бэкап/восстановление в процессе).
- `components/ui/*` — переиспользуемые UI-примитивы: `Badge`, `Button`, `ConfirmDialog`, `Modal`, `Pagination`, `Spinner`, `ToastContainer`, `SauronEyeIcon`, `ElfLeafIcon`, `MultiSelectDropdown` (чекбокс-дропдаун для мультивыбора — фильтр статусов на страницах «Алерты» и «Инциденты»).
- `components/ErrorBoundary.tsx` — глобальный перехват ошибок рендера React.

### API-клиенты (`api/`) — по одному файлу на backend-роутер

- `api/client.ts` — axios-инстанс, интерцептор авторизации/обновления токена.
- `api/auth.ts`, `api/users.ts`, `api/cases.ts`, `api/branches.ts`, `api/events.ts`, `api/iocs.ts`, `api/alerts.ts`, `api/alertRules.ts`, `api/eventSources.ts`, `api/admin.ts`, `api/statistics.ts`, `api/mitre.ts` — тонкие обёртки над соответствующими `/v1/...` эндпоинтами backend'а.
- `api/ping.ts` — `/v1/ping` (без авторизации): статус обслуживания + флаг `demo_mode_enabled`, используется страницей входа и шапкой.
- `api/demoMode.ts` — переключатель демо-режима, сидирование/очистка демо-данных (`/admin/demo-mode/*`).

### Состояние (`store/`, zustand)

- `store/auth.ts` — текущий пользователь, токены.
- `store/alert.ts` — список алертов и фильтры (страница «Алерты»).
- `store/case.ts` — текущий инцидент, его ветки/события/IOC.
- `store/maintenance.ts` — прогресс режима обслуживания.
- `store/theme.ts` — выбранная тема оформления (light/dark/sauron/elves) + favicon.
- `store/toast.ts` — очередь всплывающих уведомлений.

### Прочее

- `hooks/useTimelineWS.ts` — подключение к WebSocket и синхронизация live-обновлений timeline с `store/case`.
- `types/index.ts` — все общие TypeScript-типы (Alert, Case, Event, граф корреляций и т.д.) и словари меток/цветов статусов.
- `App.tsx` — роутинг верхнего уровня.
- `main.tsx` — точка монтирования React-приложения.
