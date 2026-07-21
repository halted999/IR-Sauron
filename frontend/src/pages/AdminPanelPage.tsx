import React, { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'
import { AppLayout } from '../components/Layout/AppLayout'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Spinner } from '../components/ui/Spinner'
import { UserFormModal } from '../components/Admin/UserFormModal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import {
  getAppSettings, updateAppSettings, backupConfig, backupDatabase,
} from '../api/admin'
import type { AppSettings } from '../api/admin'
import { getUsers, createUser, updateUser, deactivateUser, deleteUserPermanently } from '../api/users'
import type { CreateUserData, UpdateUserData } from '../api/users'
import type { User, UserRole } from '../types'
import { ROLE_LABELS } from '../types'

type Section = 'notifications' | 'users' | 'roles' | 'timezone' | 'backup'

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'notifications', label: 'Оповещения' },
  { key: 'users', label: 'Пользователи' },
  { key: 'roles', label: 'Роли и группы' },
  { key: 'timezone', label: 'Временная зона' },
  { key: 'backup', label: 'Импорт/бекап' },
]

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Полный доступ ко всем делам и разделам, управление пользователями и настройками системы.',
  ir_lead: 'Полный доступ ко всем делам независимо от участия: создание, редактирование, назначение статусов.',
  investigator: 'Ведёт расследование: создаёт события и эскалирует алерты в делах, где указан участником.',
  threat_hunter: 'Аналогично следователю — запись событий и эскалация алертов в делах, где участвует.',
  observer: 'Только просмотр дел и таймлайна, без права редактирования.',
  legal: 'Только просмотр, с фокусом на юридически значимые события и комментарии «в отчёт».',
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
          <div style={{ maxWidth: 720 }}>
            {activeSection === 'notifications' && <NotificationsSection />}
            {activeSection === 'users' && <UsersSection />}
            {activeSection === 'roles' && <RolesSection />}
            {activeSection === 'timezone' && <TimezoneSection />}
            {activeSection === 'backup' && <BackupSection />}
          </div>
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
        description="Настройки подключения. Реальная отправка сообщений по событиям (создание дела, эскалация и т.д.) в этот экран не входит — здесь только хранение конфигурации."
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
                      {u.is_active && (
                        <button
                          onClick={() => setDeactivatingUser(u)}
                          style={{ ...linkBtnStyle, color: 'var(--danger)' }}
                        >
                          Деактивировать
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
        message={`Учётная запись «${deletingUser?.username}» будет удалена безвозвратно, вместе с её данными участия в делах. Это действие нельзя отменить.`}
        confirmLabel="Удалить"
        isDanger
      />
    </div>
  )
}

// ─── Roles reference ────────────────────────────────────────────────────────────

const RolesSection: React.FC = () => (
  <div>
    <SectionHeader
      title="Роли и группы пользователей"
      description="Группы соответствуют встроенным ролям доступа. Управление ролью пользователя — в разделе «Пользователи»."
    />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(([role, label]) => (
        <div
          key={role}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 16px',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ROLE_DESCRIPTIONS[role]}</div>
        </div>
      ))}
    </div>
  </div>
)

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
                {tz}
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
        description="Бэкапы шифруются паролем (AES-256-GCM) прямо на сервере перед скачиванием. Импорт (восстановление) в этой версии не реализован — сохраните пароль в надёжном месте, он понадобится для расшифровки."
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
    </div>
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
