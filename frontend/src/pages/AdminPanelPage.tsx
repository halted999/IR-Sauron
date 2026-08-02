import React, { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'
import { useMaintenanceStore } from '../store/maintenance'
import { AppLayout } from '../components/Layout/AppLayout'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Spinner } from '../components/ui/Spinner'
import { UserFormModal } from '../components/Admin/UserFormModal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import {
  getAppSettings, updateAppSettings, backupConfig, backupDatabase, getRolePermissions, updateRolePermissions,
  restoreConfig, restoreDatabase, RESTORE_CONFIRM_PHRASE, getAuditLog,
} from '../api/admin'
import type { AppSettings, RolePermissionItem, AuditLogEntry } from '../api/admin'
import {
  getUsers, createUser, updateUser, deactivateUser, activateUser, deleteUserPermanently,
} from '../api/users'
import type { CreateUserData, UpdateUserData } from '../api/users'
import {
  getEventSources, createEventSource, updateEventSource, deleteEventSource,
  testEventSourceConnection, syncEventSourceNow,
} from '../api/eventSources'
import type { EventSource, CreateEventSourceData, UpdateEventSourceData } from '../api/eventSources'
import { EventSourceFormModal } from '../components/Admin/EventSourceFormModal'
import type { User, UserRole } from '../types'
import { ROLE_LABELS } from '../types'

type Section = 'notifications' | 'users' | 'roles' | 'event_sources' | 'timezone' | 'backup' | 'audit_log'

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'notifications', label: 'Оповещения' },
  { key: 'users', label: 'Пользователи' },
  { key: 'roles', label: 'Роли пользователей' },
  { key: 'event_sources', label: 'Источники алертов' },
  { key: 'timezone', label: 'Временная зона' },
  { key: 'backup', label: 'Импорт/бекап' },
  { key: 'audit_log', label: 'Лог действий' },
]

const SOURCE_TYPE_LABELS: Record<string, string> = {
  elastic: 'Elastic',
  thehive: 'TheHive',
  file_watch: 'Чтение из файла',
  email: 'Электронная почта',
  json_api: 'JSON по API-ключу',
}

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Полный доступ ко всем инцидентам и разделам, управление пользователями и настройками системы.',
  ir_lead: 'Полный доступ ко всем инцидентам независимо от участия: создание, редактирование, назначение статусов.',
  investigator: 'Ведёт расследование: создаёт события и эскалирует алерты в инцидентах, где указан участником.',
  observer: 'Только просмотр инцидентов и таймлайна, без права редактирования.',
  external_contractor: 'Внешний подрядчик с ограниченным доступом только на чтение.',
}

const TIMEZONES = [
  'UTC',
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'Asia/Dubai',
  'Asia/Shanghai',
]

function tzOffsetMinutes(timeZone: string, date: Date = new Date()): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  dtf.formatToParts(date).forEach((p) => {
    if (p.type !== 'literal') parts[p.type] = p.value
  })
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  )
  return Math.round((asUTC - date.getTime()) / 60000)
}

function tzOffsetLabel(timeZone: string): string {
  let minutes: number
  try {
    minutes = tzOffsetMinutes(timeZone)
  } catch {
    return ''
  }
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`
}

export const AdminPanelPage: React.FC = () => {
  const { user } = useAuthStore()
  const [activeSection, setActiveSection] = useState<Section>('notifications')

  if (user && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <AppLayout>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left nav */}
        <div
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            padding: '20px 12px',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', padding: '0 8px 12px' }}>
            ПАНЕЛЬ АДМИНИСТРИРОВАНИЯ
          </div>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                marginBottom: 2,
                borderRadius: 6,
                border: 'none',
                background: activeSection === s.key ? 'var(--bg-tertiary)' : 'transparent',
                color: activeSection === s.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: activeSection === s.key ? 600 : 400,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          {activeSection === 'event_sources' ? (
            <EventSourcesSection />
          ) : activeSection === 'users' ? (
            <UsersSection />
          ) : activeSection === 'audit_log' ? (
            <AuditLogSection />
          ) : (
            <div style={{ maxWidth: 720 }}>
              {activeSection === 'notifications' && <NotificationsSection />}
              {activeSection === 'roles' && <RolesSection />}
              {activeSection === 'timezone' && <TimezoneSection />}
              {activeSection === 'backup' && <BackupSection />}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}

// ─── Notifications ────────────────────────────────────────────────────────────

const NotificationsSection: React.FC = () => {
  const toast = useToastStore()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    getAppSettings()
      .then(setSettings)
      .catch(() => toast.error('Ошибка загрузки настроек'))
      .finally(() => setIsLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const handleSave = async () => {
    if (!settings) return
    setIsSaving(true)
    try {
      const updated = await updateAppSettings({
        smtp_host: settings.smtp_host,
        smtp_port: settings.smtp_port,
        smtp_username: settings.smtp_username,
        smtp_password: settings.smtp_password,
        smtp_from_email: settings.smtp_from_email,
        smtp_use_tls: settings.smtp_use_tls,
        email_notifications_enabled: settings.email_notifications_enabled,
        telegram_bot_token: settings.telegram_bot_token,
        telegram_chat_id: settings.telegram_chat_id,
        telegram_notifications_enabled: settings.telegram_notifications_enabled,
      })
      setSettings(updated)
      toast.success('Настройки оповещений сохранены')
    } catch {
      toast.error('Ошибка сохранения настроек')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading || !settings) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <Spinner size={28} />
      </div>
    )
  }

  return (
    <div>
      <SectionHeader
        title="Оповещения на почту и в Telegram-бота"
        description="Настройки подключения. Реальная отправка сообщений по событиям (создание инцидента, эскалация и т.д.) в этот экран не входит — здесь только хранение конфигурации."
      />

      <Card>
        <CardTitle>Email (SMTP)</CardTitle>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.email_notifications_enabled}
            onChange={(e) => setField('email_notifications_enabled', e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span style={{ fontSize: 13 }}>Включить email-оповещения</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Field label="SMTP-сервер">
            <input
              type="text"
              value={settings.smtp_host ?? ''}
              onChange={(e) => setField('smtp_host', e.target.value)}
              placeholder="smtp.example.com"
            />
          </Field>
          <Field label="Порт">
            <input
              type="number"
              value={settings.smtp_port ?? ''}
              onChange={(e) => setField('smtp_port', e.target.value ? Number(e.target.value) : null)}
              placeholder="587"
            />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="Логин">
            <input
              type="text"
              value={settings.smtp_username ?? ''}
              onChange={(e) => setField('smtp_username', e.target.value)}
            />
          </Field>
          <Field label="Пароль">
            <input
              type="password"
              value={settings.smtp_password ?? ''}
              onChange={(e) => setField('smtp_password', e.target.value)}
            />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Email отправителя">
            <input
              type="email"
              value={settings.smtp_from_email ?? ''}
              onChange={(e) => setField('smtp_from_email', e.target.value)}
              placeholder="ir-sauron@example.com"
            />
          </Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.smtp_use_tls}
            onChange={(e) => setField('smtp_use_tls', e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span style={{ fontSize: 13 }}>Использовать TLS</span>
        </label>
      </Card>

      <Card>
        <CardTitle>Telegram-бот</CardTitle>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.telegram_notifications_enabled}
            onChange={(e) => setField('telegram_notifications_enabled', e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span style={{ fontSize: 13 }}>Включить Telegram-оповещения</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Токен бота">
            <input
              type="password"
              value={settings.telegram_bot_token ?? ''}
              onChange={(e) => setField('telegram_bot_token', e.target.value)}
              placeholder="123456:ABC-DEF..."
            />
          </Field>
          <Field label="Chat ID">
            <input
              type="text"
              value={settings.telegram_chat_id ?? ''}
              onChange={(e) => setField('telegram_chat_id', e.target.value)}
              placeholder="-100123456789"
            />
          </Field>
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={handleSave} isLoading={isSaving}>
          Сохранить
        </Button>
      </div>
    </div>
  )
}

// ─── Users ─────────────────────────────────────────────────────────────────────

const UsersSection: React.FC = () => {
  const toast = useToastStore()
  const { user: currentUser } = useAuthStore()
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [deactivatingUser, setDeactivatingUser] = useState<User | null>(null)
  const [deletingUser, setDeletingUser] = useState<User | null>(null)

  const load = () => {
    setIsLoading(true)
    getUsers()
      .then(setUsers)
      .catch(() => toast.error('Ошибка загрузки пользователей'))
      .finally(() => setIsLoading(false))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (data: CreateUserData | UpdateUserData) => {
    try {
      if (editingUser) {
        const updated = await updateUser(editingUser.id, data as UpdateUserData)
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
        toast.success('Пользователь обновлён')
      } else {
        const created = await createUser(data as CreateUserData)
        setUsers((prev) => [created, ...prev])
        toast.success(`Пользователь «${created.username}» создан`)
      }
    } catch {
      toast.error('Ошибка сохранения пользователя')
      throw new Error('save failed')
    }
  }

  const handleDeactivate = async () => {
    if (!deactivatingUser) return
    try {
      await deactivateUser(deactivatingUser.id)
      setUsers((prev) =>
        prev.map((u) => (u.id === deactivatingUser.id ? { ...u, is_active: false } : u)),
      )
      toast.success('Пользователь деактивирован')
    } catch {
      toast.error('Ошибка деактивации')
    } finally {
      setDeactivatingUser(null)
    }
  }

  const handleActivate = async (u: User) => {
    try {
      const updated = await activateUser(u.id)
      setUsers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      toast.success('Пользователь активирован')
    } catch {
      toast.error('Ошибка активации')
    }
  }

  const handleDelete = async () => {
    if (!deletingUser) return
    try {
      await deleteUserPermanently(deletingUser.id)
      setUsers((prev) => prev.filter((u) => u.id !== deletingUser.id))
      toast.success('Пользователь удалён')
    } catch {
      toast.error('Ошибка удаления пользователя')
    } finally {
      setDeletingUser(null)
    }
  }

  return (
    <div>
      <SectionHeader title="Список пользователей" description="Управление учётными записями и ролями." />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setEditingUser(null)
            setShowModal(true)
          }}
        >
          + Создать пользователя
        </Button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <Spinner size={26} />
        </div>
      ) : (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <Th>Логин</Th>
                <Th>Email</Th>
                <Th>Роль</Th>
                <Th>Статус</Th>
                <Th>Действия</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, idx) => (
                <tr key={u.id} style={{ borderTop: idx > 0 ? '1px solid var(--border)' : 'none' }}>
                  <Td>
                    <div style={{ fontWeight: 500 }}>{u.username}</div>
                    {u.full_name && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{u.full_name}</div>
                    )}
                  </Td>
                  <Td>{u.email}</Td>
                  <Td>{ROLE_LABELS[u.role]}</Td>
                  <Td>
                    <Badge
                      color={u.is_active ? 'green' : 'gray'}
                      label={u.is_active ? 'Активен' : 'Отключён'}
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={() => {
                          setEditingUser(u)
                          setShowModal(true)
                        }}
                        style={linkBtnStyle}
                      >
                        Изменить
                      </button>
                      {u.is_active ? (
                        <button
                          onClick={() => setDeactivatingUser(u)}
                          style={{ ...linkBtnStyle, color: 'var(--danger)' }}
                        >
                          Деактивировать
                        </button>
                      ) : (
                        <button
                          onClick={() => handleActivate(u)}
                          style={{ ...linkBtnStyle, color: 'var(--success)' }}
                        >
                          Активировать
                        </button>
                      )}
                      {u.id !== currentUser?.id && (
                        <button
                          onClick={() => setDeletingUser(u)}
                          style={{ ...linkBtnStyle, color: 'var(--danger)' }}
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSave}
        user={editingUser}
      />

      <ConfirmDialog
        isOpen={!!deactivatingUser}
        onClose={() => setDeactivatingUser(null)}
        onConfirm={handleDeactivate}
        title="Деактивировать пользователя"
        message={`Пользователь «${deactivatingUser?.username}» потеряет доступ к системе. Продолжить?`}
        confirmLabel="Деактивировать"
        isDanger
      />

      <ConfirmDialog
        isOpen={!!deletingUser}
        onClose={() => setDeletingUser(null)}
        onConfirm={handleDelete}
        title="Удалить пользователя"
        message={`Учётная запись «${deletingUser?.username}» будет удалена безвозвратно, вместе с её данными участия в инцидентах. Это действие нельзя отменить.`}
        confirmLabel="Удалить"
        isDanger
      />
    </div>
  )
}

// ─── Audit log ────────────────────────────────────────────────────────────────

const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: 'Создание',
  update: 'Изменение',
  auto_raise_mitre: 'Авто-повышение по MITRE ATT&CK',
  archive: 'Архивация',
  unarchive: 'Разархивация',
  delete: 'Удаление',
  soft_delete: 'Удаление (в корзину)',
  restore: 'Восстановление',
  purge: 'Безвозвратное удаление',
  activate: 'Активация',
  deactivate: 'Деактивация',
  merge: 'Слияние',
  assign: 'Назначение',
  unassign: 'Снятие назначения',
  create_link: 'Создание связи',
  delete_link: 'Удаление связи',
  add_participant: 'Добавление участника',
  remove_participant: 'Удаление участника',
  link_ioc: 'Привязка IOC',
  unlink_ioc: 'Отвязка IOC',
  detach_from_case: 'Открепление от инцидента',
  escalate_from_alert: 'Эскалация в инцидент',
  escalate_from_alerts_bulk: 'Эскалация в инцидент (массово)',
  create_from_selection: 'Создание из выборки',
  upload: 'Загрузка',
}

const AUDIT_OBJECT_LABELS: Record<string, string> = {
  case: 'Инцидент',
  alert: 'Алерт',
  alert_rule: 'Правило алертов',
  branch: 'Ветка',
  event: 'Событие',
  event_link: 'Связь событий',
  event_source: 'Источник алертов',
  ioc: 'IOC',
  event_ioc: 'Привязка IOC к событию',
  artifact: 'Артефакт',
  comment: 'Комментарий',
  case_participant: 'Участник инцидента',
  user: 'Пользователь',
  role_permissions: 'Права ролей',
  settings: 'Настройки',
  config: 'Конфигурация',
  database: 'База данных',
}

const AUDIT_OBJECT_TYPES = Object.keys(AUDIT_OBJECT_LABELS)
const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABELS)

const AuditLogSection: React.FC = () => {
  const toast = useToastStore()
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [objectTypeFilter, setObjectTypeFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')

  useEffect(() => {
    getUsers().catch(() => []).then((list) => setUsers(list ?? []))
  }, [])

  const load = () => {
    setIsLoading(true)
    getAuditLog({
      limit: 300,
      object_type: objectTypeFilter || undefined,
      action: actionFilter || undefined,
      user_id: userFilter || undefined,
    })
      .then(setEntries)
      .catch(() => toast.error('Ошибка загрузки лога действий'))
      .finally(() => setIsLoading(false))
  }

  useEffect(load, [objectTypeFilter, actionFilter, userFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const isDeletion = (entry: AuditLogEntry) =>
    (entry.action === 'delete' || entry.action === 'soft_delete' || entry.action === 'purge') &&
    (entry.object_type === 'case' || entry.object_type === 'alert')

  return (
    <div>
      <SectionHeader
        title="Лог действий"
        description="Изменения настроек панели администрирования, а также факты удаления инцидентов и алертов."
      />

      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 220 }}>
          <label htmlFor="audit-object-type">Тип объекта</label>
          <select
            id="audit-object-type"
            value={objectTypeFilter}
            onChange={(e) => setObjectTypeFilter(e.target.value)}
          >
            <option value="">Все</option>
            {AUDIT_OBJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {AUDIT_OBJECT_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 220 }}>
          <label htmlFor="audit-action">Действие</label>
          <select id="audit-action" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">Все</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 220 }}>
          <label htmlFor="audit-user">Пользователь</label>
          <select id="audit-user" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
            <option value="">Все</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.username}
              </option>
            ))}
          </select>
        </div>
        <Button variant="ghost" size="sm" onClick={load}>
          Обновить
        </Button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <Spinner size={26} />
        </div>
      ) : (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <Th>Время</Th>
                <Th>Пользователь</Th>
                <Th>Действие</Th>
                <Th>Объект</Th>
                <Th>Инцидент</Th>
                <Th>Детали</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr
                  key={entry.id}
                  style={{
                    borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                    background: isDeletion(entry) ? 'rgba(248, 81, 73, 0.08)' : undefined,
                  }}
                >
                  <Td>{format(new Date(entry.ts), 'dd.MM.yyyy HH:mm:ss', { locale: ru })}</Td>
                  <Td>{entry.username ?? '—'}</Td>
                  <Td>
                    <span style={{ color: isDeletion(entry) ? 'var(--danger)' : undefined, fontWeight: isDeletion(entry) ? 600 : undefined }}>
                      {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                  </Td>
                  <Td>{AUDIT_OBJECT_LABELS[entry.object_type] ?? entry.object_type}</Td>
                  <Td>{entry.case_title ?? '—'}</Td>
                  <Td>
                    {entry.details && Object.keys(entry.details).length > 0 ? (
                      <span
                        style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}
                        title={JSON.stringify(entry.details, null, 2)}
                      >
                        {JSON.stringify(entry.details).slice(0, 120)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    Записей не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Roles ──────────────────────────────────────────────────────────────────────

const RolesSection: React.FC = () => {
  const toast = useToastStore()
  const [permissions, setPermissions] = useState<RolePermissionItem[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [expandedRole, setExpandedRole] = useState<UserRole | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    getRolePermissions()
      .then((res) => {
        setPermissions(res.permissions)
        setLabels(res.labels)
      })
      .catch(() => toast.error('Ошибка загрузки прав доступа'))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const permsForRole = (role: UserRole) => permissions.filter((p) => p.role === role)

  const handleToggle = async (role: UserRole, permission: string, allowed: boolean) => {
    const key = `${role}:${permission}`
    setSavingKey(key)
    setPermissions((prev) =>
      prev.map((p) => (p.role === role && p.permission === permission ? { ...p, allowed } : p)),
    )
    try {
      await updateRolePermissions([{ role, permission, allowed }])
    } catch {
      toast.error('Ошибка сохранения прав')
      setPermissions((prev) =>
        prev.map((p) => (p.role === role && p.permission === permission ? { ...p, allowed: !allowed } : p)),
      )
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div>
      <SectionHeader
        title="Роли пользователей"
        description="Нажмите на роль, чтобы настроить её права доступа. Управление ролью конкретного пользователя — в разделе «Пользователи». Роль «Администратор» всегда обладает полным доступом и не настраивается."
      />
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '30px 0' }}>
          <Spinner size={26} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(([role, label]) => {
            const isAdmin = role === 'admin'
            const isExpanded = expandedRole === role
            return (
              <div
                key={role}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => !isAdmin && setExpandedRole(isExpanded ? null : role)}
                  disabled={isAdmin}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '14px 16px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-primary)',
                    cursor: isAdmin ? 'default' : 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontFamily: 'inherit',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ROLE_DESCRIPTIONS[role]}</div>
                  </div>
                  {!isAdmin && (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', marginLeft: 12 }}>
                      {isExpanded ? '▲ Свернуть' : '▼ Настроить'}
                    </span>
                  )}
                </button>

                {isExpanded && !isAdmin && (
                  <div
                    style={{
                      padding: '2px 16px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    {permsForRole(role).map((p) => (
                      <label
                        key={p.permission}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          cursor: 'pointer',
                          padding: '8px 0',
                          color: 'var(--text-primary)',
                          opacity: savingKey === `${role}:${p.permission}` ? 0.6 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={p.allowed}
                          disabled={savingKey === `${role}:${p.permission}`}
                          onChange={(e) => handleToggle(role, p.permission, e.target.checked)}
                          style={{ width: 'auto' }}
                        />
                        <span style={{ fontSize: 13 }}>{labels[p.permission] ?? p.permission}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Event Sources (Elastic / TheHive) ────────────────────────────────────────

const EventSourcesSection: React.FC = () => {
  const toast = useToastStore()
  const [sources, setSources] = useState<EventSource[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingSource, setEditingSource] = useState<EventSource | null>(null)
  const [deletingSource, setDeletingSource] = useState<EventSource | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = () => {
    setIsLoading(true)
    getEventSources()
      .then(setSources)
      .catch(() => toast.error('Ошибка загрузки источников алертов'))
      .finally(() => setIsLoading(false))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (data: CreateEventSourceData | UpdateEventSourceData) => {
    try {
      if (editingSource) {
        const updated = await updateEventSource(editingSource.id, data as UpdateEventSourceData)
        setSources((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
        toast.success('Источник обновлён')
      } else {
        const created = await createEventSource(data as CreateEventSourceData)
        setSources((prev) => [created, ...prev])
        toast.success(`Источник «${created.name}» создан`)
      }
    } catch {
      toast.error('Ошибка сохранения источника')
      throw new Error('save failed')
    }
  }

  const handleDelete = async () => {
    if (!deletingSource) return
    try {
      await deleteEventSource(deletingSource.id)
      setSources((prev) => prev.filter((s) => s.id !== deletingSource.id))
      toast.success('Источник удалён')
    } catch {
      toast.error('Ошибка удаления источника')
    } finally {
      setDeletingSource(null)
    }
  }

  const handleTest = async (source: EventSource) => {
    setBusyId(source.id)
    try {
      const result = await testEventSourceConnection(source.id)
      if (result.ok) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch {
      toast.error('Ошибка проверки соединения')
    } finally {
      setBusyId(null)
    }
  }

  const handleSyncNow = async (source: EventSource) => {
    setBusyId(source.id)
    try {
      const result = await syncEventSourceNow(source.id)
      toast[result.ok ? 'success' : 'error'](result.message)
      load()
    } catch {
      toast.error('Ошибка синхронизации')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <SectionHeader
        title="Источники алертов"
        description="Подключения к Elasticsearch и TheHive для автоматического получения алертов по API. Новые алерты появляются в общем списке «Оповещения»."
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setEditingSource(null)
            setShowModal(true)
          }}
        >
          + Добавить источник
        </Button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <Spinner size={26} />
        </div>
      ) : sources.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '20px 0' }}>
          Источники ещё не настроены.
        </div>
      ) : (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <Th>Имя</Th>
                <Th>Тип</Th>
                <Th>URL / папка</Th>
                <Th>Статус</Th>
                <Th>Последняя синхронизация</Th>
                <Th>Действия</Th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s, idx) => (
                <tr key={s.id} style={{ borderTop: idx > 0 ? '1px solid var(--border)' : 'none' }}>
                  <Td>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                  </Td>
                  <Td>{SOURCE_TYPE_LABELS[s.source_type] ?? s.source_type}</Td>
                  <Td>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.base_url}</span>
                  </Td>
                  <Td>
                    <Badge
                      color={s.is_enabled ? 'green' : 'gray'}
                      label={s.is_enabled ? 'Включён' : 'Отключён'}
                      size="sm"
                    />
                  </Td>
                  <Td>
                    {s.last_synced_at ? (
                      <div>
                        <div>{format(new Date(s.last_synced_at), 'dd.MM.yyyy HH:mm', { locale: ru })}</div>
                        <div style={{ fontSize: 11, color: s.last_sync_status === 'error' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                          {s.last_sync_message}
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Ещё не запускалась</span>
                    )}
                  </Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => {
                          setEditingSource(s)
                          setShowModal(true)
                        }}
                        style={linkBtnStyle}
                      >
                        Изменить
                      </button>
                      <button
                        onClick={() => handleTest(s)}
                        disabled={busyId === s.id}
                        style={linkBtnStyle}
                      >
                        Проверить соединение
                      </button>
                      <button
                        onClick={() => handleSyncNow(s)}
                        disabled={busyId === s.id}
                        style={linkBtnStyle}
                      >
                        Синхронизировать сейчас
                      </button>
                      <button
                        onClick={() => setDeletingSource(s)}
                        style={{ ...linkBtnStyle, color: 'var(--danger)' }}
                      >
                        Удалить
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EventSourceFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSave}
        source={editingSource}
      />

      <ConfirmDialog
        isOpen={!!deletingSource}
        onClose={() => setDeletingSource(null)}
        onConfirm={handleDelete}
        title="Удалить источник алертов"
        message={`Источник «${deletingSource?.name}» будет удалён. Уже полученные алерты останутся в системе.`}
        confirmLabel="Удалить"
        isDanger
      />
    </div>
  )
}

// ─── Timezone ────────────────────────────────────────────────────────────────────

const TimezoneSection: React.FC = () => {
  const toast = useToastStore()
  const [timezone, setTimezone] = useState('UTC')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    getAppSettings()
      .then((s) => setTimezone(s.timezone))
      .catch(() => toast.error('Ошибка загрузки настроек'))
      .finally(() => setIsLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateAppSettings({ timezone })
      toast.success('Временная зона сохранена')
    } catch {
      toast.error('Ошибка сохранения')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <Spinner size={28} />
      </div>
    )
  }

  return (
    <div>
      <SectionHeader
        title="Временная зона"
        description="Используется как зона по умолчанию для системы. Метки времени в интерфейсе форматируются браузером пользователя."
      />
      <Card>
        <Field label="Часовой пояс">
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ maxWidth: 320 }}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz} ({tzOffsetLabel(tz)})
              </option>
            ))}
          </select>
        </Field>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10 }}>
          Текущее время сервера: {format(new Date(), 'dd.MM.yyyy HH:mm:ss', { locale: ru })} (браузер)
        </div>
      </Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={handleSave} isLoading={isSaving}>
          Сохранить
        </Button>
      </div>
    </div>
  )
}

// ─── Backup ──────────────────────────────────────────────────────────────────────

const BackupSection: React.FC = () => {
  const toast = useToastStore()
  const [configPassword, setConfigPassword] = useState('')
  const [dbPassword, setDbPassword] = useState('')
  const [isBackingUpConfig, setIsBackingUpConfig] = useState(false)
  const [isBackingUpDb, setIsBackingUpDb] = useState(false)

  const handleConfigBackup = async () => {
    if (configPassword.trim().length < 8) {
      toast.error('Пароль должен быть не короче 8 символов')
      return
    }
    setIsBackingUpConfig(true)
    try {
      await backupConfig(configPassword.trim())
      toast.success('Зашифрованный бэкап конфигурации скачан')
      setConfigPassword('')
    } catch {
      toast.error('Ошибка создания бэкапа конфигурации')
    } finally {
      setIsBackingUpConfig(false)
    }
  }

  const handleDbBackup = async () => {
    if (dbPassword.trim().length < 8) {
      toast.error('Пароль должен быть не короче 8 символов')
      return
    }
    setIsBackingUpDb(true)
    try {
      await backupDatabase(dbPassword.trim())
      toast.success('Зашифрованный бэкап базы данных скачан')
      setDbPassword('')
    } catch {
      toast.error('Ошибка создания бэкапа базы данных')
    } finally {
      setIsBackingUpDb(false)
    }
  }

  return (
    <div>
      <SectionHeader
        title="Импорт/бекап конфигурации и базы данных"
        description="Бэкапы шифруются паролем (AES-256-GCM) прямо на сервере перед скачиванием. Импорт полностью заменяет текущие данные тем, что содержится в файле бэкапа — действие необратимо."
      />

      <Card>
        <CardTitle>Бекап конфигурации</CardTitle>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Экспортирует текущие настройки оповещений и временной зоны в зашифрованный файл.
        </div>
        <Field label="Пароль шифрования">
          <input
            type="password"
            value={configPassword}
            onChange={(e) => setConfigPassword(e.target.value)}
            placeholder="Минимум 8 символов"
          />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <Button variant="primary" size="sm" onClick={handleConfigBackup} isLoading={isBackingUpConfig}>
            Скачать бэкап конфигурации
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Бекап базы данных</CardTitle>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Полный дамп PostgreSQL (pg_dump, custom-формат), зашифрованный указанным паролем.
        </div>
        <Field label="Пароль шифрования">
          <input
            type="password"
            value={dbPassword}
            onChange={(e) => setDbPassword(e.target.value)}
            placeholder="Минимум 8 символов"
          />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <Button variant="primary" size="sm" onClick={handleDbBackup} isLoading={isBackingUpDb}>
            Скачать бэкап базы данных
          </Button>
        </div>
      </Card>

      <RestoreCard
        title="Импорт конфигурации"
        description="Восстанавливает настройки оповещений и временной зоны из зашифрованного файла бэкапа. Текущие настройки будут перезаписаны."
        confirmMessage="Настройки системы будут перезаписаны содержимым бэкапа. Продолжить?"
        successMessage="Конфигурация восстановлена"
        onRestore={async (file, password, confirmText) => {
          await restoreConfig(file, password, confirmText)
        }}
      />

      <RestoreCard
        title="Импорт базы данных"
        description="Полностью заменяет текущую базу данных содержимым файла бэкапа (pg_restore --clean). Восстановление выполняется в фоне — на это время появится страница технического обслуживания."
        confirmMessage="Это необратимо заменит ВСЮ текущую базу данных (дела, алерты, пользователей и т.д.) содержимым файла бэкапа. Продолжить?"
        successMessage="Восстановление запущено"
        onRestore={async (file, password, confirmText) => {
          await restoreDatabase(file, password, confirmText)
          useMaintenanceStore.getState().setActive(true, 'database restore in progress')
        }}
      />
    </div>
  )
}

const RestoreCard: React.FC<{
  title: string
  description: string
  confirmMessage: string
  successMessage: string
  onRestore: (file: File, password: string, confirmText: string) => Promise<void>
}> = ({ title, description, confirmMessage, successMessage, onRestore }) => {
  const toast = useToastStore()
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [isRestoring, setIsRestoring] = useState(false)

  const canSubmit = !!file && password.trim().length >= 8 && confirmText.trim() === RESTORE_CONFIRM_PHRASE

  const handleSubmit = async () => {
    if (!file || !canSubmit) return
    if (!confirm(confirmMessage)) return
    setIsRestoring(true)
    try {
      await onRestore(file, password.trim(), confirmText.trim())
      toast.success(successMessage)
      setFile(null)
      setPassword('')
      setConfirmText('')
    } catch {
      toast.error('Ошибка восстановления — проверьте пароль и файл бэкапа')
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>{description}</div>
      <Field label="Файл бэкапа (.enc)">
        <input
          type="file"
          accept=".enc"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Field label="Пароль шифрования">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль, указанный при создании бэкапа"
        />
      </Field>
      <Field label={`Подтверждение — введите «${RESTORE_CONFIRM_PHRASE}»`}>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={RESTORE_CONFIRM_PHRASE}
        />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <Button variant="danger" size="sm" onClick={handleSubmit} isLoading={isRestoring} disabled={!canSubmit}>
          Восстановить (заменит текущие данные)
        </Button>
      </div>
    </Card>
  )
}

// ─── Shared helpers ──────────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div style={{ marginBottom: 20 }}>
    <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{title}</h2>
    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{description}</p>
  </div>
)

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
      marginBottom: 16,
    }}
  >
    {children}
  </div>
)

const CardTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>{children}</h3>
)

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label>{label}</label>
    {children}
  </div>
)

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th
    style={{
      padding: '10px 16px',
      textAlign: 'left',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    }}
  >
    {children}
  </th>
)

const Td: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-primary)', verticalAlign: 'middle' }}>
    {children}
  </td>
)

const linkBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--accent)',
  fontSize: 12,
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
}
