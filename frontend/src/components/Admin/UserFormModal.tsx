import React, { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { User, UserRole } from '../../types'
import { ROLE_LABELS } from '../../types'
import type { CreateUserData, UpdateUserData } from '../../api/users'

interface UserFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CreateUserData | UpdateUserData) => Promise<void>
  user?: User | null
}

const DEFAULT_FORM = {
  username: '',
  email: '',
  full_name: '',
  role: 'observer' as UserRole,
  password: '',
}

export const UserFormModal: React.FC<UserFormModalProps> = ({ isOpen, onClose, onSave, user }) => {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof typeof DEFAULT_FORM, string>>>({})
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    if (user) {
      setForm({
        username: user.username,
        email: user.email,
        full_name: user.full_name ?? '',
        role: user.role,
        password: '',
      })
    } else {
      setForm(DEFAULT_FORM)
    }
    setErrors({})
  }, [isOpen, user])

  const setField = <K extends keyof typeof DEFAULT_FORM>(key: K, value: (typeof DEFAULT_FORM)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const validate = (): boolean => {
    const newErrors: typeof errors = {}
    if (!user && form.username.trim().length < 3) newErrors.username = 'Минимум 3 символа'
    if (!form.email.trim()) newErrors.email = 'Обязательное поле'
    if (!user && form.password.trim().length < 8) newErrors.password = 'Минимум 8 символов'
    if (user && form.password && form.password.trim().length < 8) newErrors.password = 'Минимум 8 символов'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setIsSaving(true)
    try {
      if (user) {
        const data: UpdateUserData = {
          email: form.email.trim(),
          full_name: form.full_name.trim() || undefined,
          role: form.role,
        }
        if (form.password.trim()) data.password = form.password.trim()
        await onSave(data)
      } else {
        await onSave({
          username: form.username.trim(),
          email: form.email.trim(),
          full_name: form.full_name.trim() || undefined,
          role: form.role,
          password: form.password.trim(),
        })
      }
      onClose()
    } catch {
      // error handled by parent (toast)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={user ? 'Редактировать пользователя' : 'Новый пользователь'}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            {user ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="user-username">Логин *</label>
          <input
            id="user-username"
            type="text"
            value={form.username}
            onChange={(e) => setField('username', e.target.value)}
            disabled={!!user}
            placeholder="username"
          />
          {errors.username && (
            <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.username}</span>
          )}
        </div>

        <div>
          <label htmlFor="user-email">Email *</label>
          <input
            id="user-email"
            type="email"
            value={form.email}
            onChange={(e) => setField('email', e.target.value)}
            placeholder="user@example.com"
          />
          {errors.email && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.email}</span>}
        </div>

        <div>
          <label htmlFor="user-fullname">Полное имя</label>
          <input
            id="user-fullname"
            type="text"
            value={form.full_name}
            onChange={(e) => setField('full_name', e.target.value)}
            placeholder="Имя Фамилия"
          />
        </div>

        <div>
          <label htmlFor="user-role">Роль *</label>
          <select
            id="user-role"
            value={form.role}
            onChange={(e) => setField('role', e.target.value as UserRole)}
          >
            {Object.entries(ROLE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="user-password">{user ? 'Новый пароль' : 'Пароль *'}</label>
          <input
            id="user-password"
            type="password"
            value={form.password}
            onChange={(e) => setField('password', e.target.value)}
            placeholder={user ? 'Оставьте пустым, чтобы не менять' : 'Минимум 8 символов'}
          />
          {errors.password && (
            <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.password}</span>
          )}
        </div>
      </div>
    </Modal>
  )
}
